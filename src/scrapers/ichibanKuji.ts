import { ScrapedItem } from "./types";
import { fetchHtml, parseJapaneseFullDate, sleep } from "./util";

// 一番くじ倶楽部（BANDAI SPIRITS公式）のラインナップ。フィギュア景品・ラストワン賞は
// せどり/転売の二次相場が高い定番ジャンル。各商品に店頭/オンラインの発売日が入る。
// /products は「当月発売」しか出さないため、当月＋先2ヶ月＋発売予定(plan)を巡回して
// 先の予定まで取りこぼさない（せどらーが最も欲しいのは先の発売予定）。
const BASE = "https://1kuji.com/products";

// 各商品は <li><a href="/products/SLUG"> ... <p class="date">DATE</p> ... <p class="itemName">NAME</p> </a></li>
const ITEM_RE = /<a href="\/products\/([^"]+)">([\s\S]*?)<\/a>/g;

/** 当月・翌月・翌々月の {月,年} と、発売予定(plan) の巡回URLを作る */
function listingUrls(): string[] {
  const urls: string[] = [];
  const now = new Date();
  for (let i = 0; i < 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    urls.push(`${BASE}?sale_month=${d.getMonth() + 1}&sale_year=${d.getFullYear()}`);
  }
  urls.push(`${BASE}?sale_year=plan`); // 発売予定（月未定）
  return urls;
}

export async function scrapeIchibanKuji(): Promise<ScrapedItem[]> {
  const byId = new Map<string, ScrapedItem>();

  for (const url of listingUrls()) {
    const html = await fetchHtml(url);
    for (const m of html.matchAll(ITEM_RE)) {
      const slug = m[1];
      const inner = m[2];

      const name = inner.match(/class="itemName">([^<]+)</)?.[1]?.trim();
      if (!name) continue; // 商品カード以外の /products/ リンク（カテゴリ等）を除外
      if (byId.has(slug)) continue;

      const image = inner.match(/src="(https:\/\/assets\.1kuji\.com\/[^"]+)"/)?.[1] ?? null;
      // 店頭販売の発売日が先に来る。最初の .date を発売日として使う。
      const dateText = inner.match(/class="date">([^<]+)</)?.[1]?.trim() ?? null;

      byId.set(slug, {
        source: "ichiban_kuji",
        sourceId: slug,
        title: name,
        genre: "一番くじ",
        subGenre: null,
        eventType: "発売",
        eventDate: dateText ? parseJapaneseFullDate(dateText) : null,
        eventDateText: dateText,
        price: null,
        url: `https://1kuji.com/products/${slug}`,
        imageUrl: image,
      });
    }
    await sleep(400);
  }

  return [...byId.values()];
}
