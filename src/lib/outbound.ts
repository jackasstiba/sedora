// 外部リンク（情報元 / 購入導線）の扱いを一元管理する。prisma 非依存の純関数。
//
// item.url はソースによって「公式・商品ページ」だったり「情報元(まとめブログ・Xミラー・
// プライズ告知)」だったりする。これを一律「公式・販売ページで見る」と見せると実態と食い違い、
// ユーザーは結局どこで買えるのか辿り着けない。→ ソースに応じてラベルを出し分け、
// さらに商品名で市場を検索する購入導線を別途用意する。

// item.url が実際に公式/商品ページを指すソース。
const OFFICIAL_URL_SOURCES = new Set([
  "pokemoncard", // ポケモンカード公式(pokemon-card.com)
  "pokemon_goods", // ポケモン公式グッズ(メーカー/取扱店の商品ページ)
  "ichiban_kuji", // 一番くじ倶楽部(BANDAI SPIRITS公式)
  "torecamap", // 各商品の公式販売ページに直リンク
  "nike_snkrs", // Nike SNKRS 公式の商品(launch/t)ページに直リンク
  "nyuka_now", // item.url は各小売の公式・抽選ページ（一次ソース）に直リンク
]);

/** item.url を「公式ページ」と表記してよいか（それ以外は情報元＝まとめ/告知ページ） */
export function isOfficialUrl(source: string): boolean {
  return OFFICIAL_URL_SOURCES.has(source);
}

// タイトルが商品名として市場検索に使えるソース。
// Xミラー(channeltono/rarecheck)やイベント(collabo_cafe)は「7月28日10時より…販売開始」等の
// 文章タイトルで、そのまま検索すると無関係な結果になるため購入導線を出さない。
const SEARCHABLE_SOURCES = new Set([
  "figisland",
  "figisland_pb",
  "koretore",
  "torecamap",
  "snkrdunk",
  "pokemoncard",
  "pokemon_goods",
  "ichiban_kuji",
  "nike_snkrs",
  "torecasoku",
  "nyuka_now", // 商品名（Nintendo Switch 2 等）で市場検索できる
  "tenbaiquest", // item.url は楽天検索（収集元は非公開）＝商品名で市場検索できる
]);

/** 「楽天で探す」等の購入導線（商品名検索）を出してよいソースか */
export function hasSearchableTitle(source: string): boolean {
  return SEARCHABLE_SOURCES.has(source);
}

/**
 * 商品名で楽天市場を検索するURL。
 * 収益化方針(楽天/もしもアフィリ)のアフィリンクに差し替える際はこの1箇所を変えればよい。
 */
export function rakutenSearchUrl(title: string): string {
  return `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(title.trim())}/`;
}
