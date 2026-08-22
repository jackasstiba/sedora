// EN専用カタログ（/en/catalog）に出す**公式ストアの登録簿**（Phase 3b'・2026-08-22）。
//
// なぜ店ごとにページを分けるか: 4店の在庫を1ページに集めると実測で約6,000件になり、
// ブラウザへ渡す量も1画面の意味も破綻する（hololive 545 / ちいかわ 2,932 / ナガノ 484 /
// mofusand 2,043）。店ごとなら1ページの規模が既存の /en（約2,500件）と同じ水準に収まり、
// 「どの店の在庫か」という読者の見方とも一致する。
//
// **店名を出してよい根拠**: ここに載るのは全て一次情報の公式ストア＝
// `src/lib/outbound.ts` の OFFICIAL_URL_SOURCES に入っているソース（＝ item.url を
// 「公式ページ」と表記してよい＝収集元非公開の対象外）。まとめ記事・アグリゲータは
// **絶対にここへ足さない**（足すと収集元が割れる）。追加時は必ず isOfficialUrl を確認する。
import { isOfficialUrl } from "./outbound";

export type EnCatalogStore = {
  /** DB の Item.source */
  source: string;
  /** URL の一部（/en/catalog/<slug>） */
  slug: string;
  /** 画面に出す店名（店自身の名乗りをそのまま） */
  name: string;
  /** 何のグッズの店か（英語1行・事実のみ。在庫や入手性は約束しない） */
  blurb: string;
};

export const EN_CATALOG_STORES: EnCatalogStore[] = [
  {
    source: "hololive_shop",
    slug: "hololive",
    name: "hololive production OFFICIAL SHOP",
    blurb: "Official goods for hololive / holostars VTuber talents.",
  },
  {
    source: "chiikawa_market",
    slug: "chiikawa",
    name: "Chiikawa Market",
    blurb: "The official store for Chiikawa and its characters.",
  },
  {
    source: "nagano_market",
    slug: "nagano",
    name: "Nagano Market",
    blurb: "Official goods for Nagano's characters, from the creator of Chiikawa.",
  },
  {
    source: "mofusand_market",
    slug: "mofusand",
    name: "mofusand Mofumofu Market",
    blurb: "The official store for mofusand's cat characters.",
  },
];

/** slug から店を引く（未知の slug は null＝ページを作らない）。 */
export function enCatalogStoreBySlug(slug: string): EnCatalogStore | null {
  return EN_CATALOG_STORES.find((s) => s.slug === slug) ?? null;
}

/** source から店を引く。 */
export function enCatalogStoreBySource(source: string): EnCatalogStore | null {
  return EN_CATALOG_STORES.find((s) => s.source === source) ?? null;
}

/** EN専用カタログのページ名（src/lib/pages.ts / scope.ts / sitemap が同じ定義を使う）。 */
export const EN_CATALOG_HUB_PATH = "/en/catalog";
export function enCatalogPath(slug: string): string {
  return `${EN_CATALOG_HUB_PATH}/${slug}`;
}
export function enCatalogPagePaths(): string[] {
  return [EN_CATALOG_HUB_PATH, ...EN_CATALOG_STORES.map((s) => enCatalogPath(s.slug))];
}

/**
 * 登録簿の店が全部「公式ページと表記してよい」ソースか（＝店名を出しても収集元が割れない）。
 * audit:selftest がこれを固定する。**文章の約束ではなく機械の判定で守る。**
 */
export function enCatalogStoresAreOfficial(): boolean {
  return EN_CATALOG_STORES.every((s) => isOfficialUrl(s.source));
}

/**
 * その収集元の**商品名が、店の構造化フィールドから来ている**か（Shopify の `products.json` の
 * `title`）。＝こちらが文章から切り出したものではないので、**途中で切れることが原理的に無い**。
 *
 * なぜ要るか（2026-08-22 実測・Phase 3b'）: 「タイトル末尾が宙ぶらりん助詞」の検査は
 * *記事本文から商品名を切り出す*収集元のために作った網なのに、公式ストアの正規商品名まで
 * 見ていたので誤検知が出た——`hololive friends with u 風真いろは`（タレント名）4件、
 * `mofusand 木製スタンプ⑩なでなでなでなで`（擬音の商品名）1件。どちらも店が付けた正しい名前で、
 * 直す対象は1つも無い。この面に検査を当て続けると、**本物の切れ残りが誤検知に埋もれる**。
 *
 * 既存の `title_noise`（実況の残骸）を X ミラー限定にしているのと同じ考え方＝
 * **その粗が起こりうる面にだけ検査を当てる。**
 */
export function hasStoreProvidedTitle(source: string): boolean {
  return EN_CATALOG_STORES.some((s) => s.source === source);
}
