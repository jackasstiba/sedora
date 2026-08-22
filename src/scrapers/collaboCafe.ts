import { ScrapedItem } from "./types";
import {
  analyzeCollab,
  extractMapUrl,
  extractVenues,
  formatVenueStores,
  extractArticleBody,
  extractOfficialItems,
  extractOfficialSale,
  extractOfficialUrl,
  formatOfficialItems,
  formatSale,
  parseShopifyOfficialItems,
  pickVerifiedEventDate,
  shopifyJsonUrl,
} from "./collaboEnrich";
import {
  classifyGenre,
  extractDateAndEventFromText,
  fetchHtml,
  monthPlanDate,
  parseJapaneseFullDate,
  parseJapaneseYearMonth,
  sleep,
} from "./util";
import { crawlPages } from "./crawl";
import { todayJst } from "../lib/date";

// コラボカフェ.com: アニメ・ゲーム・VTuber等のコラボカフェ / くじ / ポップアップ /
// 店舗タイアップ / グッズ情報を横断的にまとめているアグリゲーター。
// トップ(新着横断) + せどり向けの物販系カテゴリ + ホロライブ専用カテゴリを巡回し、
// post-ID で重複排除する。カテゴリを個別に見ることで、トップに載らない作品別コラボ
// (例: ホロライブ×極楽湯の各弾) も取りこぼさない。
const LISTING_URLS = [
  "https://collabo-cafe.com/",
  "https://collabo-cafe.com/events/category/goods/",
  "https://collabo-cafe.com/events/category/kuji/",
  "https://collabo-cafe.com/events/category/pop-up-store/",
  "https://collabo-cafe.com/events/category/shop-tieup/",
  "https://collabo-cafe.com/events/category/cafe/",
  "https://collabo-cafe.com/events/category/hololive/",
  // 2026-08-15 追加: 物販のある未巡回カテゴリ（実測でサイトは13カテゴリ持ち、6つしか
  // 巡回していなかった）。fashion=アパレルコラボ（しまむら/UT型＝転売対象）、
  // event=期間限定イベント物販、theme-park/原画展=会場限定グッズ。
  "https://collabo-cafe.com/events/category/fashion/",
  "https://collabo-cafe.com/events/category/event/",
  "https://collabo-cafe.com/events/category/theme-park/",
  "https://collabo-cafe.com/events/category/gengaten-tenjikai/",
];

/**
 * カテゴリ一覧を何ページまで辿るかの安全弁（終端は下の `pageIsAllPast`＝中身で決める）。
 *
 * 2026-08-18 まで「カテゴリは2ページまで。3ページ目以降は過去開催が大半」という**推測**で
 * 固定していたが、実測すると**開催前のイベントが2ページ目より奥に大量に残っていた**:
 *   pop-up-store … 10ページ辿ってもまだ開催前があり、その範囲で開催前**61件**
 *   gengaten-tenjikai … 6ページ/開催前25件 ／ cafe … 5ページ/開催前31件
 * ＝先頭2ページで切っていた分は「収集元にあるのにサイトに無い」（[[System/rules]] 観点D）。
 * 同じ型を同日に nyuka_now・channeltono・tenbaiquest でも直している（crawl.ts 参照）。
 */
const MAX_LIST_PAGES = 15;

/**
 * 足切り: **このページの日付が分かる記事が1件以上あり、その全部が開催済み**なら、
 * 以降のページは見ない（記事は新しい順＝奥ほど過去）。
 *
 * ページ数ではなく中身で止める理由: カテゴリごとに投稿ペースが全く違う（実測で1〜10ページ超）。
 * 「何ページ目までが有効か」は書いた瞬間から古くなる。日付が読めない記事は判定に使わない
 * （読めないことを理由に巡回を止めると、書式が変わった日にソースが縮む）。
 */
function pageIsAllPast(todayMs: number): (items: ScrapedItem[]) => boolean {
  return (items) => {
    const dated = items.filter((it) => it.eventDate);
    return dated.length > 0 && dated.every((it) => it.eventDate!.getTime() < todayMs);
  };
}

// article class の event-category-* から拾う種別スラッグ → 表示ラベル
const TYPE_LABELS: Record<string, string> = {
  cafe: "カフェ",
  kuji: "くじ",
  "pop-up-store": "ポップアップ",
  "shop-tieup": "店舗コラボ",
  goods: "グッズ",
  "gengaten-tenjikai": "原画展",
  "theme-park": "テーマパーク",
  event: "イベント",
  fashion: "ファッション",
};

const ARTICLE_RE = /<article class="post-list[\s\S]*?<\/article>/g;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();
}

function pickSubGenre(block: string): string {
  for (const slug of Object.keys(TYPE_LABELS)) {
    if (block.includes(`event-category-${slug}`)) return TYPE_LABELS[slug];
  }
  return "キャンペーン";
}

function parseArticle(block: string): ScrapedItem | null {
  const id = block.match(/\bpost-(\d+)\b/)?.[1];
  const url = block.match(/<a href="(https:\/\/collabo-cafe\.com\/events\/[^"]+)"/)?.[1];
  const rawTitle = block.match(/entry-title[^>]*>([^<]+)</)?.[1];
  if (!id || !url || !rawTitle) return null;

  const title = decodeEntities(rawTitle);
  const image = block.match(/data-src="(https:\/\/collabo-cafe\.com\/[^"]+)"/)?.[1] ?? null;

  // 例: 「期間 : 2026年7月24日〜8月31日」→ 開始日をイベント日に、テキストは範囲を残す
  const periodRaw = block.match(/event-date[^>]*>([^<]*)</)?.[1] ?? "";
  const period = periodRaw.replace(/^\s*期間\s*[:：]\s*/, "").trim();
  // 「2026年10月発売予定」のような月精度は monthPlanDate の規約で月初を持たせる
  // （当月＝月初が過去なら null のまま）。日は作らない＝表示は「2026年10月」のまま。
  // これが無いと未来月の物販が eventDate=null で「発売中」ビューに混ざる（実測 2026-08-22: 94件）。
  const ym = parseJapaneseYearMonth(period);
  const eventDate =
    parseJapaneseFullDate(period) ??
    extractDateAndEventFromText(title).date ??
    (ym ? monthPlanDate(ym.getUTCFullYear(), ym.getUTCMonth() + 1, todayJst()) : null);

  // くじ・グッズは「物販」なので、コラボ一括ではなく中身でジャンル判定し「発売」にする。
  // （例: 一番くじ商品が genre=コラボ / eventType=開催 になっていた分類ズレの修正）
  // カフェ・ポップアップ・店舗コラボ等の“場のイベント”は従来どおり コラボ / 開催。
  const subGenre = pickSubGenre(block);
  const isMerch = subGenre === "くじ" || subGenre === "グッズ";
  let genre = "コラボ";
  if (isMerch) {
    const g = classifyGenre(title);
    genre = g === "その他" ? "コラボ" : g;
  }

  return {
    source: "collabo_cafe",
    sourceId: id,
    title,
    genre,
    subGenre,
    eventType: isMerch ? "発売" : "開催",
    eventDate,
    eventDateText: period || null,
    price: null,
    url,
    imageUrl: image,
  };
}

export async function scrapeCollaboCafe(): Promise<ScrapedItem[]> {
  const today = todayJst().getTime();
  const byId = new Map<string, ScrapedItem>();

  for (const base of LISTING_URLS) {
    // トップ(新着横断)はページ送りしない＝1ページで止める（カテゴリ側で全部拾える）。
    const isCategory = base.includes("/events/category/");
    const found = await crawlPages<ScrapedItem>({
      label: base,
      urlOf: (p) => (p === 1 ? base : `${base}page/${p}/`),
      parse: (html) =>
        [...html.matchAll(ARTICLE_RE)]
          .map((m) => parseArticle(m[0]))
          .filter((it): it is ScrapedItem => !!it),
      keyOf: (it) => it.sourceId,
      isPageOld: isCategory ? pageIsAllPast(today) : () => true,
      maxPages: isCategory ? MAX_LIST_PAGES : 1,
      sleepMs: 500,
    });
    for (const item of found) if (!byId.has(item.sourceId)) byId.set(item.sourceId, item);
  }

  const items = [...byId.values()];

  // 一覧カードでは「開催」1行止まりで、そのコラボで“何が売られる/当たる”かに届かない。
  // 各イベントについて (a) collabo-cafe 記事本文から抽選/ランダム有無＋注目賞品名を、
  // (b) 記事内の一次情報（公式キャンペーン/ストア）ページへ飛んで販売商品の価格帯・点数を
  // 取得して合成する。レート制限つき・失敗時は取れた分だけ活かす（壊さない）。
  //
  // **扱うのは掲載される行だけ**（開催前＋日付未定＋直近に終わった分）。掲載スコープは
  // `eventDate >= today` または日付なしなので、とっくに終わった記事を深掘りしても
  // 1文字も画面に出ない。巡回範囲を「2ページ固定」から終端まで広げた分（実測で記事数は
  // 約2倍）をここで相殺する＝**時間を増やさずに取りこぼしだけ無くす**。
  //
  // ⚠️ **深掘りを飛ばした行は返さない**（＝upsertしない）。scrape.ts の upsert は
  // `highlights: item.highlights ?? null` のように書くので、深掘りせずに返すと
  // **既にDBに入っている賞品情報・会場・公式リンクを null で上書きして消す**
  // （[[scrapeのnull上書き注意]]）。返さなければその行はDBでそのまま残る。
  //
  // 猶予14日: 収集元の一覧の日付は誤っていることがあり（実測 #20308 が2日ズレ）、
  // 記事本文で訂正すると未来日に戻ることがある。今日で切ると、その訂正の機会ごと失う。
  const ENRICH_GRACE_DAYS = 14;
  const enrichFrom = today - ENRICH_GRACE_DAYS * 86_400_000;
  const enrichTargets = items.filter((it) => !it.eventDate || it.eventDate.getTime() >= enrichFrom);
  console.log(
    `[collabo_cafe] 記事${items.length}件 / 深掘り＋保存の対象（開催前・日付未定・直近${ENRICH_GRACE_DAYS}日）${enrichTargets.length}件`
  );
  for (const item of enrichTargets) {
    try {
      const html = await fetchHtml(item.url);
      const body = extractArticleBody(html);
      const enr = analyzeCollab(body, item.subGenre);
      item.hasLottery = enr.hasLottery;

      // 開催日の裏取り。一覧の「期間 :」は収集元側で誤っていることがあるので、記事本文の
      // 「開催期間」とタイトルの日付が一致したときだけ訂正する（推測では動かさない）。
      //
      // ※ これは reenrich でも行うが、**スクレイプ自体に入れないと訂正が消える**。
      //   実測: 再エンリッチで 8/6→8/8 に直した #20308 が、次の通常スクレイプで
      //   一覧の誤った日付に上書きされ、監査のラチェットで再発が検出された。
      //   「一度直した正しい値が通常の更新で壊される」経路を塞ぐ。
      const verified = pickVerifiedEventDate(body, item.title, item.eventDate ?? null);
      if (verified) {
        item.eventDate = verified.date;
        item.eventDateText = verified.text;
      }

      // 一次情報（公式）へ飛んで販売商品を取る（best-effort・12秒でアボート）。
      // 対応ドメイン（rakuspa等）は商品名＋個別価格をカテゴリ正規化して要約、
      // 未対応ドメインは価格帯のみにフォールバック。
      // 「開催」＝カフェ/ポップアップ/展示のイベント記事。公式は会場・キャンペーンのページで
      // あって1点の商品ページではないので、個別商品ページは候補から外す（extractOfficialUrl）。
      const official = extractOfficialUrl(html, { allowSingleProduct: item.eventType !== "開催" });
      item.officialUrl = official;
      let saleText: string | null = null;
      if (official) {
        // ① Shopify の公開JSON（URLの形で判断・JSONが返れば自己検証済み）＝最も正確。
        const shopItems = await fetchShopifyItems(official);
        if (shopItems) saleText = formatOfficialItems(shopItems);
        if (!saleText) {
          const officialHtml = await fetchOfficial(official);
          if (officialHtml) {
            // ② サイト別パーサ（rakuspa等） ③ 価格帯だけのフォールバック
            const officialItems = extractOfficialItems(official, officialHtml);
            if (officialItems) saleText = formatOfficialItems(officialItems);
            if (!saleText) {
              const sale = extractOfficialSale(officialHtml);
              if (sale) saleText = formatSale(sale);
            }
          }
        }
        await sleep(300);
      }

      // 「どこへ行けば買えるか」＝開催店舗＋地図。コラボ/ポップアップ/カフェは会場限定なので、
      // 会場が分からないと行きようがない（監査 no_purchase_route が拾っていた最大の塊）。
      item.stores = formatVenueStores(extractVenues(html), extractMapUrl(html));

      // 「何が売られるか」＝賞品名（記事）＋価格帯（公式）を合成して highlights に。
      const parts = [enr.highlights, saleText].filter(Boolean);
      item.highlights = parts.length ? parts.join(" ｜ ") : null;
    } catch {
      // 本文/公式の取得に失敗しても一覧情報は活かす（深掘りだけ諦める）
    }
    await sleep(400);
  }

  // 深掘りした行だけを返す（上のコメント参照＝返さない行はDBでそのまま残る）。
  return enrichTargets;
}

/**
 * 公式URLが Shopify の形なら公開JSONを取り、{商品名, 価格} を返す（そうでなければ null）。
 * 取りに行くのは URL が `/collections/…` か `/products/…` のときだけ＝無駄打ちしない。
 * JSONが返らなければ Shopify ではないので null（＝HTMLのパーサへ落ちる）。
 */
async function fetchShopifyItems(url: string): Promise<{ name: string; price: number }[] | null> {
  const jsonUrl = shopifyJsonUrl(url);
  if (!jsonUrl) return null;
  const body = await fetchOfficial(jsonUrl);
  return body ? parseShopifyOfficialItems(body) : null;
}

// 公式サイトは各社バラバラ（遅い/SPA/別文字コード）なので、タイムアウトを付けて
// スクレイプ全体が止まらないようにする。失敗（遅延/非200/例外）は null で握りつぶす。
async function fetchOfficial(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SedoriRadar/1.0)" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}
