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
  pickVerifiedEventDate,
} from "./collaboEnrich";
import {
  classifyGenre,
  extractDateAndEventFromText,
  fetchHtml,
  parseJapaneseFullDate,
  sleep,
} from "./util";

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
];

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
  const eventDate = parseJapaneseFullDate(period) ?? extractDateAndEventFromText(title).date;

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
  const byId = new Map<string, ScrapedItem>();

  for (const listUrl of LISTING_URLS) {
    const html = await fetchHtml(listUrl);
    for (const m of html.matchAll(ARTICLE_RE)) {
      const item = parseArticle(m[0]);
      if (item && !byId.has(item.sourceId)) byId.set(item.sourceId, item);
    }
    await sleep(500);
  }

  const items = [...byId.values()];

  // 一覧カードでは「開催」1行止まりで、そのコラボで“何が売られる/当たる”かに届かない。
  // 各イベントについて (a) collabo-cafe 記事本文から抽選/ランダム有無＋注目賞品名を、
  // (b) 記事内の一次情報（公式キャンペーン/ストア）ページへ飛んで販売商品の価格帯・点数を
  // 取得して合成する。レート制限つき・失敗時は取れた分だけ活かす（壊さない）。
  for (const item of items) {
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
        const officialHtml = await fetchOfficial(official);
        if (officialHtml) {
          const officialItems = extractOfficialItems(official, officialHtml);
          if (officialItems) saleText = formatOfficialItems(officialItems);
          if (!saleText) {
            const sale = extractOfficialSale(officialHtml);
            if (sale) saleText = formatSale(sale);
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

  return items;
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
