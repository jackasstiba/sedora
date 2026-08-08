import { ScrapedItem } from "./types";
import { parseJapaneseFullDate } from "./util";

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
  link_pokemonCenter: string; // ポケモンセンターオンラインの商品ページ（周辺グッズはこちらだけ）
};

/**
 * その商品を実際に見られるページ。
 *
 * 周辺グッズ（デッキシールド・デッキケース）は公式サイト側に個別ページが存在せず
 * link_detailPage が空で、従来は全件が一覧 `/products/` に落ちていた（＝別商品なのに
 * 同じリンク先。実測3件）。公式APIが持つ link_pokemonCenter がポケモンセンター
 * オンラインの個別商品ページ（JANコード）なので、それを次点で使う。
 * utm は配信元の計測パラメータなので落とす（同じ商品ページのまま）。
 */
function productUrl(p: PokecaProduct): string {
  if (p.link_detailPage) return `${ORIGIN}${p.link_detailPage}`;
  if (p.link_pokemonCenter) {
    try {
      const u = new URL(p.link_pokemonCenter);
      for (const k of [...u.searchParams.keys()]) if (k.startsWith("utm_")) u.searchParams.delete(k);
      return u.toString();
    } catch {
      return p.link_pokemonCenter;
    }
  }
  return `${ORIGIN}/products/`;
}

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
      url: productUrl(p),
      imageUrl: p.tumbsImg ? `${ORIGIN}${p.tumbsImg}` : null,
    });
  }

  return items;
}
