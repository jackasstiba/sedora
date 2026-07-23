import { ScrapedItem } from "./types";
import { extractDateAndEventFromText, fetchHtml, parseJapaneseFullDate, sleep } from "./util";

// コラボカフェ.com: アニメ・ゲーム・VTuber等のコラボカフェ / くじ / ポップアップ /
// 店舗タイアップ / グッズ情報を横断的にまとめているアグリゲーター。
// トップページ(新着横断) + VTuberタグ(ホロライブ等)を取得し post-ID で重複排除する。
const LISTING_URLS = [
  "https://collabo-cafe.com/",
  "https://collabo-cafe.com/events/tag/vtuber/",
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

  return {
    source: "collabo_cafe",
    sourceId: id,
    title,
    genre: "コラボ",
    subGenre: pickSubGenre(block),
    eventType: "開催",
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

  return [...byId.values()];
}
