import { ScrapedItem } from "./types";
import { fetchHtml, parseJapaneseFullDate } from "./util";

// 一番くじ倶楽部（BANDAI SPIRITS公式）のラインナップ。フィギュア景品・ラストワン賞は
// せどり/転売の二次相場が高い定番ジャンル。各商品に店頭/オンラインの発売日が入る。
const URL = "https://1kuji.com/products";

// 各商品は <li><a href="/products/SLUG"> ... <p class="date">DATE</p> ... <p class="itemName">NAME</p> </a></li>
const ITEM_RE = /<a href="\/products\/([^"]+)">([\s\S]*?)<\/a>/g;

export async function scrapeIchibanKuji(): Promise<ScrapedItem[]> {
  const html = await fetchHtml(URL);
  const byId = new Map<string, ScrapedItem>();

  for (const m of html.matchAll(ITEM_RE)) {
    const slug = m[1];
    const inner = m[2];

    const name = inner.match(/class="itemName">([^<]+)</)?.[1]?.trim();
    if (!name) continue; // 商品カード以外の /products/ リンク（カテゴリ等）を除外

    const image = inner.match(/src="(https:\/\/assets\.1kuji\.com\/[^"]+)"/)?.[1] ?? null;
    // 店頭販売の発売日が先に来る。最初の .date を発売日として使う。
    const dateText = inner.match(/class="date">([^<]+)</)?.[1]?.trim() ?? null;

    if (byId.has(slug)) continue;
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

  return [...byId.values()];
}
