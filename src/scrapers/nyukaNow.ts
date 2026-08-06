import { ScrapedItem } from "./types";
import { fetchHtml, resolveMonthDay, sleep } from "./util";
import { classifyAggregatorGenre, cleanStoreUrl, NOISE_LINK, stripTags } from "./aggregatorUtil";

// 「日本時間の今日」を時刻なしの暦日(UTC0時)で返す（util.ts の calDate 規約と同じ）。
function todayCal(): Date {
  const j = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate()));
}

// 入荷Now（nyuka-now.com）の「抽選・予約」情報を全カテゴリ横断で収集する。
//
// 【方針・2026-08-04 本人確定】入荷Nowの抽選情報は "全部" 取り込む。ただしフロントには
// 収集元（入荷Nowの名・その記事へのリンク）を一切出さない＝「情報源にしていない体裁」。
// 各商品まとめ記事の「抽選・予約応募受付中のストア」節から《小売名＋公式抽選ページURL＋締切＋
// 販売形式＋応募条件》を抽出し、ハツコレには各小売の“公式ページ”へ直リンクして掲載する。
// これで掲載元は常に公式になり、アグリゲーターを情報源として明かさずに済む。
//
// 取得方式: 入荷Nowは素の fetch で取れる WordPress。カテゴリ「抽選情報」の一覧を全ページ巡回し、
// 各記事の「抽選・予約応募受付中のストア」節を解析する。ジャンル（家電・ゲーム機/酒・ウイスキー/
// トレカ/フィギュア/プラモ/ソフビ・アートトイ等）は商品名から推定する。

const CATEGORY_BASE = "https://nyuka-now.com/archives/category/chusen";
const ARTICLE_BASE = "https://nyuka-now.com/archives/";
const MAX_PAGES = 8; // 実測3ページ。将来増えても取りこぼさないよう余裕を持たせる。

type Article = { id: string; title: string };

/** カテゴリ一覧ページから記事(id,title)を集める。 */
function parseArticleList(html: string): Article[] {
  const seen = new Set<string>();
  const out: Article[] = [];
  const re = /<a[^>]+href="https:\/\/nyuka-now\.com\/archives\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g;
  for (const m of html.matchAll(re)) {
    const id = m[1];
    const title = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!title || title.length < 4 || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, title });
  }
  return out;
}

/** カテゴリを全ページ巡回して記事一覧を集める（重複id除去）。 */
async function collectArticles(): Promise<Article[]> {
  const byId = new Map<string, Article>();
  for (let p = 1; p <= MAX_PAGES; p++) {
    const url = p === 1 ? CATEGORY_BASE : `${CATEGORY_BASE}/page/${p}`;
    let html: string;
    try {
      html = await fetchHtml(url);
    } catch {
      break; // 次ページが無い（404）＝巡回終了
    }
    const list = parseArticleList(html);
    let added = 0;
    for (const a of list) {
      if (!byId.has(a.id)) {
        byId.set(a.id, a);
        added++;
      }
    }
    if (added === 0) break; // 新規が無くなったら終了
    await sleep(400);
  }
  return [...byId.values()];
}

/** タイトル「【…更新】商品名（各種）の抽選・予約情報まとめ」から商品名だけを取り出す。 */
function cleanProductName(title: string): string {
  let t = title.replace(/^【[^】]*】\s*/, "");
  t = t.replace(/各種の抽選[・･].*$/, "");
  t = t.replace(/の抽選[・･].*$/, "");
  t = t.replace(/各種\s*$/, "");
  return t.trim();
}

/** 記事本文の「抽選・予約応募受付中のストア」節（次の<h2>まで）を切り出す。無ければ null。 */
function extractLiveSection(html: string): string | null {
  const marker = "抽選・予約応募受付中のストア";
  const i = html.indexOf(marker);
  if (i < 0) return null;
  const rest = html.slice(i + marker.length);
  const j = rest.search(/<h2[\s>]/);
  return j < 0 ? rest : rest.slice(0, j);
}

/** ストアブロック(h3の後ろ)から公式・抽選ページURLを1つ選ぶ。 */
function pickStoreUrl(blockHtml: string): string | null {
  const links = [...blockHtml.matchAll(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
    .map((m) => ({ href: m[1], text: stripTags(m[2]) }))
    .filter((l) => !NOISE_LINK.test(l.href));
  if (links.length === 0) return null;
  // 「詳細ページ」「応募ページ」「商品ページ」等、明示的な導線を優先。
  const preferred = links.find((l) => /(詳細|応募|商品|抽選|購入|予約)ページ/.test(l.text));
  return cleanStoreUrl((preferred ?? links[0]).href);
}

/** 応募条件（購入履歴・会員登録など＝当落を左右する“せどりの肝”）を短く取り出す。 */
function parseCondition(vis: string): string | null {
  const m = vis.match(
    /応募条件\s*([\s\S]{4,120}?)(?:\s*(?:応募方法|抽選日|当[選落]発表|当選発表|発売日|販売期間|価格|対象商品|販売形式|開始日|応募期間|受付期間|$))/
  );
  if (!m) return null;
  // 1文目（。まで）に絞り、注釈(※)や長すぎる場合は切り詰める。
  let c = m[1].trim().replace(/^[:：]\s*/, "");
  const dot = c.indexOf("。");
  if (dot > 8) c = c.slice(0, dot);
  c = c.replace(/\s+/g, " ").trim();
  if (c.length > 70) c = c.slice(0, 68) + "…";
  return c.length >= 4 ? c : null;
}

/** ストアブロックの可視テキストから 販売形式 と 受付/締切テキスト＋日付 を取り出す。 */
function parseStoreMeta(vis: string): { form: string | null; when: string | null; date: Date | null } {
  const NEXT = "(?:対象商品|販売形式|開始日|応募期間|受付期間|予約期間|販売期間|応募条件|応募方法|抽選日|当[選落]発表|当選発表|発売日|価格|$)";
  const formM = vis.match(new RegExp(`販売形式\\s*([^\\s]{1,16}?)\\s*${NEXT}`));
  const form = formM ? formM[1].trim() : null;

  // 締切のある「応募期間/受付期間/予約期間/販売期間」を優先、無ければ「開始日」。
  const periodM = vis.match(
    new RegExp(`(?:応募期間|受付期間|予約期間|販売期間)\\s*([0-9０-９]{1,2}月[0-9０-９]{1,2}日[\\s\\S]{0,40}?)${NEXT}`)
  );
  const startM = vis.match(
    /開始日\s*([0-9０-９]{1,2}月[0-9０-９]{1,2}日(?:\([月火水木金土日]\))?(?:\s*[0-9０-９]{1,2}[:：][0-9０-９]{2})?)/
  );

  const raw = periodM ? periodM[1] : startM ? startM[1] : null;
  if (!raw) return { form, when: null, date: null };

  const norm = raw.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).trim();
  const dates = [...norm.matchAll(/(\d{1,2})月(\d{1,2})日/g)];
  // 応募期間は末尾(締切)、開始日は先頭を採用。
  const pick = periodM ? dates[dates.length - 1] : dates[0];
  const date = pick ? resolveMonthDay(Number(pick[1]), Number(pick[2])) : null;

  const timeM = norm.match(/(\d{1,2})[:：](\d{2})/);
  const md = pick ? `${Number(pick[1])}/${Number(pick[2])}` : "";
  let when: string;
  if (periodM) {
    when = md ? `〜${md}` : norm; // 締切
  } else {
    when = md ? `${md}${timeM ? " " + timeM[1] + ":" + timeM[2] : ""}〜` : norm; // 開始
  }
  return { form, when, date };
}

type Store = {
  name: string;
  url: string;
  form: string | null;
  when: string | null;
  note: string | null;
  date: Date | null;
};

function parseStores(sectionHtml: string): Store[] {
  const blocks = sectionHtml.split(/<h3[^>]*>/).slice(1);
  const stores: Store[] = [];
  for (const b of blocks) {
    const end = b.indexOf("</h3>");
    if (end < 0) continue;
    const name = stripTags(b.slice(0, end));
    const after = b.slice(end + 5);
    if (!name || name.length > 40) continue;
    const url = pickStoreUrl(after);
    if (!url) continue; // 公式リンクが無いブロックは載せられない
    const vis = stripTags(after);
    const { form, when, date } = parseStoreMeta(vis);
    stores.push({ name, url, form, when, note: parseCondition(vis), date });
  }
  return stores;
}

export async function scrapeNyukaNow(): Promise<ScrapedItem[]> {
  // 抽選まとめ記事だけを対象にする（「アプリ更新のお願い」等の告知記事を除外）。
  const articles = (await collectArticles()).filter((a) => a.title.includes("抽選"));

  const today = todayCal();
  const items: ScrapedItem[] = [];

  for (const a of articles) {
    let html: string;
    try {
      html = await fetchHtml(ARTICLE_BASE + a.id);
    } catch {
      continue;
    }
    await sleep(400); // 配信元への負荷に配慮

    const section = extractLiveSection(html);
    if (!section) continue; // 受付中のストアが無い＝掲載しない
    const stores = parseStores(section);
    if (stores.length === 0) continue;

    const product = cleanProductName(a.title);
    if (!product) continue;

    // 表示日＝受付中ストアのうち「今日以降で最も近い」日（締切/開始日）。全て過去/未定なら null。
    const futureDates = stores
      .map((s) => s.date)
      .filter((d): d is Date => !!d && d.getTime() >= today.getTime())
      .sort((x, y) => x.getTime() - y.getTime());
    const eventDate = futureDates[0] ?? null;

    const summary = stores
      .slice(0, 3)
      .map((s) => `${s.name}${s.form || s.when ? `（${[s.form, s.when].filter(Boolean).join("・")}）` : ""}`)
      .join("、");
    const more = stores.length > 3 ? ` 他${stores.length - 3}店` : "";

    // 販売形式から抽選/先着を判定する。入荷Nowの「抽選情報」カテゴリでも、受付中の実店舗は
    // 「先着販売」「予約」のことがある。全ストアが先着/予約なら“抽選ではない”ので抽選扱いしない。
    // （招待制/エントリー/応募＝当落があるので抽選扱い。）本人指摘「先着なのに抽選と出る」の修正。
    const isLotteryForm = (f: string | null) => !!f && /抽選|抽籤|招待|エントリー|応募/.test(f);
    const hasLottery = stores.some((s) => isLotteryForm(s.form));

    items.push({
      source: "nyuka_now",
      sourceId: a.id,
      title: product,
      genre: classifyAggregatorGenre(product),
      subGenre: null,
      // 抽選ストアがあれば「抽選」、無ければ「予約受付中」（先着/予約＝抽選ではない）。
      eventType: hasLottery ? "抽選" : "予約受付中",
      eventDate,
      eventDateText: eventDate ? null : hasLottery ? "抽選・予約 受付中" : "予約・先着 受付中",
      price: null,
      url: stores[0].url, // 一次ソース（公式・小売の抽選ページ）。アグリゲーターは出さない。
      imageUrl: null,
      highlights: `受付中ストア：${summary}${more}`,
      hasLottery,
      stores: JSON.stringify(
        stores.map((s) => ({ name: s.name, url: s.url, form: s.form, when: s.when, note: s.note }))
      ),
    });
  }

  return items;
}
