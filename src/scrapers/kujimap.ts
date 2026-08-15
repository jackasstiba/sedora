import { ScrapedItem } from "./types";
import { fetchHtml, parseJapaneseFullDate, sleep } from "./util";
import { cleanStoreUrl, stripTags } from "./aggregatorUtil";

// くじびき全国マップ（kujimap.com）: 一番くじ以外のくじブランド
// （セガ ラッキーくじ / フリューくじ(みんくじ) / タイトーくじ・Happyくじ等の「その他のくじ」/
//   オンライン販売くじ / Specialくじ）の発売スケジュール・賞ラインナップ・ロット内訳を持つ
// 非公式アグリゲーター。
//
// 【方針】収集元は完全非公開（[[収集元の扱い方]]と同じ）: item.url は各くじの**公式LP**
// （segaplaza.jp / furyuprize.com 等）へ直リンクし、kujimap の名・リンクは一切出さない。
// 公式LPが取れないページは掲載しない（url を「公式ページ」と表示するため）。
//
// 【対象外】/1bankuji/ は公式（一番くじ倶楽部）を既にスクレイプしているので取らない
// （同じくじが2ソースから別ジャンルに入る＝dedupe の死角、を作らない）。
//
// 【発見経路】WordPress サイトマップ（sitemap.xml → sitemap-pt-page-p*-YYYY-MM.xml）。
// ブランド別インデックス（/segaluck 等）は2011年からの全くじが日付なしで並ぶため使えない。
// 新しいくじのページは直近の月ファイルに載るので、直近 RECENT_MONTHS ヶ月分だけ読む。
// 発売日が過去に過ぎたものはここで落とす（古いページの lastmod 更新に引きずられない）。

const SITEMAP_INDEX = "https://kujimap.com/sitemap.xml";
const RECENT_MONTHS = 4;
const MAX_DETAIL_FETCH = 80; // 暴走保険（通常は月に数十ページ）

// パス先頭セグメント → ブランド表示名（サイトのナビ表記に合わせる）
const BRANDS: Record<string, string> = {
  segaluck: "セガ ラッキーくじ",
  minkuji: "フリューくじ",
  online_kuji: "オンラインくじ",
  others: "くじ",
  specialkuji: "くじ",
};

const DETAIL_PATH_RE = /^https:\/\/kujimap\.com\/(segaluck|minkuji|online_kuji|others|specialkuji)\/([^/]+)$/;

/** stripTags は &amp;/&nbsp; しか戻さない。数値エンティティ（&#8217; 等）を実文字に戻す。
 *  実測: PINGU&#8217;S がカード名に生のまま表示された。 */
function decodeNumericEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]{1,6});/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d{1,7});/g, (_, n) => String.fromCodePoint(Number(n)));
}

// 公式リンクとして使えないもの（SNS・共有・インフラ）
const NON_OFFICIAL_LINK = /twitter\.com|x\.com|facebook\.com|line\.me|b\.hatena|getpocket\.com|wordpress\.org|google\.com|kujimap\.com/i;

/** サイトマップ index から直近 RECENT_MONTHS ヶ月のページ用サイトマップURLを選ぶ。 */
export function pickRecentPageSitemaps(indexXml: string, reference = new Date()): string[] {
  const urls = [...indexXml.matchAll(/<loc>(https:\/\/kujimap\.com\/sitemap-pt-page-p\d+-(\d{4})-(\d{2})\.xml)<\/loc>/g)];
  const refYm = reference.getUTCFullYear() * 12 + reference.getUTCMonth();
  return urls
    .filter((m) => {
      const ym = Number(m[2]) * 12 + (Number(m[3]) - 1);
      return refYm - ym < RECENT_MONTHS;
    })
    .map((m) => m[1]);
}

/** ページ用サイトマップから対象ブランドの詳細ページURLを抜き出す。 */
export function pickKujiDetailUrls(sitemapXml: string): string[] {
  const out: string[] = [];
  for (const m of sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    if (DETAIL_PATH_RE.test(m[1])) out.push(m[1]);
  }
  return out;
}

export type KujiDetail = {
  name: string;
  date: Date | null; // 日まで分かるときだけ
  monthText: string | null; // 「2026年09月開催予定」のような月精度のときの原文
  lotSize: number | null; // 1セット（N本）
  prizes: { label: string; name: string; count: number | null }[];
  officialUrl: string | null;
};

/** くじ詳細ページを解析する。日付・賞内訳は wp-table-reloaded のヘッダ/行から。 */
export function parseKujiDetail(html: string): KujiDetail | null {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const name = h1 ? decodeNumericEntities(stripTags(h1[1])) : "";
  if (!name) return null;

  const body = html.slice(html.indexOf("</head>"));

  // 「2026年06月23日開催予定」（日精度）／「2026年09月開催予定」（月精度）
  const head = body.match(/<th[^>]*>\s*(\d{4}年\d{1,2}月(?:\d{1,2}日)?)(開催|発売)予定\s*<\/th>/);
  let date: Date | null = null;
  let monthText: string | null = null;
  if (head) {
    if (/日/.test(head[1])) date = parseJapaneseFullDate(head[1]);
    else monthText = `${head[1]}${head[2]}予定`;
  }

  const lotM = body.match(/1セット（(\d+)本）/);
  const lotSize = lotM ? Number(lotM[1]) : null;

  // 賞の行: <tr>…<td>S賞</td><td>名称</td><td>2</td><td>全1種</td>…（列数はページで揺れる）
  const prizes: KujiDetail["prizes"] = [];
  for (const tr of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) =>
      decodeNumericEntities(stripTags(c[1]))
    );
    if (cells.length < 2) continue;
    const label = cells[0];
    if (!/^(?:[A-Z]{1,2}賞|ラスト\S*賞?|ダブルチャンス)/.test(label)) continue;
    const pname = cells[1];
    if (!pname) continue;
    const countCell = cells.find((c, i) => i >= 2 && /^\d+$/.test(c));
    prizes.push({ label, name: pname, count: countCell ? Number(countCell) : null });
  }

  // 公式LP: 本文中の最初の非SNS外部リンク（実測: くじ名をアンカーにした segaplaza/furyuprize 等）。
  // 収集元はアフィリラッパー(ValueCommerce等)経由の**通販検索リンク**も置いており（実測: FFXくじが
  // ck.jp.ap.valuecommerce.com→Yahoo検索だった）、それを「公式ページ」と呼ぶのは嘘になる。
  // cleanStoreUrl でラッパーを解いた上で、検索・モール系ホストは公式候補から除外する。
  const SEARCH_HOST = /search\.shopping\.yahoo\.co\.jp|shopping\.yahoo\.co\.jp\/search|search\.rakuten\.co\.jp|amazon\.co\.jp\/s\b|aucview|mercari\.com\/search/i;
  let officialUrl: string | null = null;
  for (const a of body.matchAll(/<a[^>]+href="(https?:\/\/[^"]+)"/g)) {
    if (NON_OFFICIAL_LINK.test(a[1])) continue;
    const cleaned = cleanStoreUrl(a[1]);
    if (!cleaned || SEARCH_HOST.test(cleaned)) continue;
    officialUrl = cleaned;
    break;
  }

  return { name, date, monthText, lotSize, prizes, officialUrl };
}

/** 掲載判定＋行の組み立て（純関数・selftest対象）。掲載しないときは null。 */
export function buildKujimapItem(
  url: string,
  detail: KujiDetail,
  reference = new Date()
): ScrapedItem | null {
  const m = url.match(DETAIL_PATH_RE);
  if (!m) return null;
  if (!detail.officialUrl) return null; // url は「公式ページ」と表示するため必須

  // 発売日が7日以上過去のくじは載せない（サイトマップは古いページのlastmod更新も拾うため）。
  if (detail.date) {
    const age = (reference.getTime() - detail.date.getTime()) / 86_400_000;
    if (age > 7) return null;
  } else if (detail.monthText) {
    // 月精度: その月が過ぎていたら載せない（月末まで有効とみなす）
    const ym = detail.monthText.match(/(\d{4})年(\d{1,2})月/);
    if (ym) {
      const endOfMonth = new Date(Date.UTC(Number(ym[1]), Number(ym[2]), 0));
      if (endOfMonth.getTime() < reference.getTime()) return null;
    }
  } else {
    return null; // 日付が全く読めないページは載せない
  }

  // 賞名は長文のことがある（対象キャラの列挙付き等）。表示用は40字で切る。
  const short = (s: string) => (s.length > 40 ? s.slice(0, 39) + "…" : s);
  const top = detail.prizes.slice(0, 3).map((p) => `${p.label} ${short(p.name)}`);
  const rest = detail.prizes.length - top.length;
  const lot = detail.lotSize ? `（1セット${detail.lotSize}本）` : "";
  const highlights =
    detail.prizes.length > 0
      ? `各賞ラインナップ：${top.join("・")}${rest > 0 ? ` 他${rest}賞` : ""}${lot}`
      : null;

  return {
    source: "kujimap",
    sourceId: `${m[1]}_${m[2]}`,
    title: detail.name,
    genre: "くじ",
    subGenre: BRANDS[m[1]] === "くじ" ? null : BRANDS[m[1]],
    eventType: "発売",
    eventDate: detail.date,
    eventDateText: detail.date ? null : detail.monthText,
    price: null,
    url: detail.officialUrl,
    imageUrl: null,
    highlights,
    hasLottery: true,
    prizes: detail.prizes.length
      ? JSON.stringify(detail.prizes.map((p) => ({ label: p.label, name: p.name })))
      : undefined,
  };
}

export async function scrapeKujimap(): Promise<ScrapedItem[]> {
  const index = await fetchHtml(SITEMAP_INDEX);
  const sitemaps = pickRecentPageSitemaps(index);

  const urls = new Set<string>();
  for (const sm of sitemaps) {
    try {
      for (const u of pickKujiDetailUrls(await fetchHtml(sm))) urls.add(u);
    } catch {
      // 月ファイルが無い月はスキップ
    }
    await sleep(300);
  }

  const items: ScrapedItem[] = [];
  let fetched = 0;
  for (const u of urls) {
    if (fetched >= MAX_DETAIL_FETCH) break;
    let html: string;
    try {
      html = await fetchHtml(u);
    } catch {
      continue;
    }
    fetched++;
    await sleep(400);
    const detail = parseKujiDetail(html);
    if (!detail) continue;
    const item = buildKujimapItem(u, detail);
    if (item) items.push(item);
  }
  return items;
}
