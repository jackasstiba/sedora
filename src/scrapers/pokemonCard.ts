import { ScrapedItem } from "./types";
import { parseJapaneseFullDate } from "./util";

// ポケモンカードゲーム公式の商品情報。SPAが叩く topList.php（JSON）を直接取得する。
// 拡張パック等の発売はトレカせどりの最重要イベント（1件の価値が高い）。
const API = "https://www.pokemon-card.com/products/topList.php";
const ORIGIN = "https://www.pokemon-card.com";

export type PokecaProduct = {
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
export function productUrl(p: PokecaProduct, goodsIndex: Map<string, string>): string {
  if (p.link_detailPage) {
    // 特設サイト（30周年 www.30th.pokemon-card.com）は絶対URLで来る。ORIGIN を前置すると
    // 「https://www.pokemon-card.comhttps://www.30th…」という壊れたリンクになる（実測 2026-09-12:
    // 拡張パック「30th CELEBRATION」＝一番の目玉が死リンクで本番に出ていた）。
    return /^https?:\/\//.test(p.link_detailPage) ? p.link_detailPage : `${ORIGIN}${p.link_detailPage}`;
  }
  if (p.link_pokemonCenter) {
    try {
      const u = new URL(p.link_pokemonCenter);
      for (const k of [...u.searchParams.keys()]) if (k.startsWith("utm_")) u.searchParams.delete(k);
      return u.toString();
    } catch {
      return p.link_pokemonCenter;
    }
  }
  // 特設サイトの周辺グッズ紹介ページに同名の見出しがあれば、その節（#id）に送る（下の goodsIndex）。
  const special = goodsIndex.get(p.productTitle.replace(/\s+/g, " ").trim());
  if (special) return special;
  return `${ORIGIN}/products/`;
}

/**
 * 特設サイトの周辺グッズ紹介ページから「商品名 → 節のURL（#id）」を作る（純関数・selftest対象）。
 *
 * 実測 2026-09-12: 30周年の周辺グッズ3件（デッキシールド プレミアム・グロス 30th CELEBRATION 等）は
 * 公式APIに link_detailPage も link_pokemonCenter も無く、全件が一覧 /products/ に落ちていた
 * （audit shared_url）。特設サイト /product/goods-01〜05 に商品ごとの節
 * `<div id="goods-shield-01"> … <span class="SubHeading_text…">商品名</span>` があるので、そこへ送る。
 */
export function parseGoodsIndex(pageUrl: string, html: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /<div id="(goods-[a-z]+-\d+)"[^>]*>[\s\S]{0,600}?<span class="SubHeading_text[^"]*">([^<]+)<\/span>/g;
  for (const m of html.matchAll(re)) {
    const name = m[2].replace(/\s+/g, " ").trim();
    if (name && !out.has(name)) out.set(name, `${pageUrl}#${m[1]}`);
  }
  return out;
}

/** 特設サイト（link_detailPage が絶対URLの製品がある時だけ）の周辺グッズ紹介ページを開いて索引を作る。 */
async function buildGoodsIndex(products: PokecaProduct[]): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  const hosts = new Set<string>();
  for (const p of products) {
    const m = p.link_detailPage?.match(/^(https?:\/\/[^/]+)/);
    if (m) hosts.add(m[1]);
  }
  for (const host of hosts) {
    let top: string;
    try {
      top = await fetchText(`${host}/product`);
    } catch {
      continue;
    }
    const pages = [...new Set([...top.matchAll(/href="(\/product\/goods-\d+)"/g)].map((m) => `${host}${m[1]}`))].slice(0, 8);
    for (const url of pages) {
      try {
        for (const [name, u] of parseGoodsIndex(url, await fetchText(url))) if (!index.has(name)) index.set(name, u);
      } catch {
        // 1ページ開けなくても他は続ける（開けなかった商品は一覧URLのまま＝audit が数える）
      }
    }
  }
  return index;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
  });
  if (!res.ok) throw new Error(`fetch failed: ${url} (${res.status})`);
  return res.text();
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
  const goodsIndex = await buildGoodsIndex(products);
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
      url: productUrl(p, goodsIndex),
      imageUrl: p.tumbsImg ? `${ORIGIN}${p.tumbsImg}` : null,
    });
  }

  return items;
}
