import { ScrapedItem } from "./types";
import { fetchHtml, parseJapaneseFullDate } from "./util";

// ポケモンカードゲーム公式の商品情報。SPAが叩く topList.php（JSON）を直接取得する。
// 拡張パック等の発売はトレカせどりの最重要イベント（1件の価値が高い）。
const API = "https://www.pokemon-card.com/products/topList.php";
const ORIGIN = "https://www.pokemon-card.com";

type PokecaProduct = {
  productTitle: string;
  productType: string; // 拡張パック / 構築デッキ / 周辺グッズ
  tumbsImg: string;
  releaseDate: string; // "2026年 7月31日（金）"
  priceTxt: string;
  link_detailPage: string;
};

async function fetchJson(url: string): Promise<{ products?: PokecaProduct[] }> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "X-Requested-With": "XMLHttpRequest",
      Referer: `${ORIGIN}/products/`,
    },
  });
  if (!res.ok) throw new Error(`fetch failed: ${url} (${res.status})`);
  return res.json();
}

export async function scrapePokemonCard(): Promise<ScrapedItem[]> {
  const json = await fetchJson(API);
  const products = json.products ?? [];
  const items: ScrapedItem[] = [];

  for (const p of products) {
    if (!p.productTitle) continue;
    // 画像ファイル名を安定IDに（例: /products/2026/images/stormemeralda.jpg → stormemeralda）
    const slug =
      p.tumbsImg?.split("/").pop()?.replace(/\.[a-z]+$/i, "") ||
      p.link_detailPage ||
      p.productTitle;

    items.push({
      source: "pokemoncard",
      sourceId: slug,
      title: p.productTitle,
      genre: "トレカ",
      subGenre: p.productType || "ポケモンカード",
      eventType: "発売",
      eventDate: parseJapaneseFullDate(p.releaseDate || ""),
      eventDateText: p.releaseDate || null,
      price: p.priceTxt || null,
      url: p.link_detailPage ? `${ORIGIN}${p.link_detailPage}` : `${ORIGIN}/products/`,
      imageUrl: p.tumbsImg ? `${ORIGIN}${p.tumbsImg}` : null,
    });
  }

  return items;
}
