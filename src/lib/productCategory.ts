/**
 * サイトのジャンル語彙 → Google Product Taxonomy（GPC）への対応表。
 *
 * なぜ要るか: 構造化データの `category` に日本語のジャンル名（"プラモ" 等）をそのまま入れていたら、
 * Search Console が **「項目『category』の値が無効です」** を出した
 * （2026-08-18 検出・実例 /items/75544「SDEX ガンダムエクシア」＝ genre "プラモ"）。
 * Google は `category` に「GPCの CategoryCode」か「自由文の独自カテゴリ」を許すが、
 * GPCとして解釈できる値が1つも無いと無効扱いになる。
 *
 * 方針: **1対1で確実に言い切れるジャンルだけ**GPCを付ける。中身が混ざるジャンル（コラボ・くじ・
 * キャラグッズ等）は null ＝ category を出さない。無理に近いカテゴリへ寄せると、
 * 「スニーカー」でも「フィギュア」でもない物を Google にそう申告することになる。
 * 語彙は itemFilter.ts の GENRE_ORDER が唯一の定義。**GENRE_ORDER に足したらここにも足す**
 * （足し忘れは audit の product_category_vocab が ERROR で鳴らす）。
 *
 * id は taxonomy-with-ids.en-US.txt の数値ID（2021-09-21版で実在を確認済み）。
 * path は人間が読むための控えで、出力には使わない（長い英語パスの打ち間違いを避けるため
 * codeValue は数値IDを出す。Google はID・パスのどちらも受け付ける）。
 */
export type GoogleProductCategory = { id: string; path: string };

export const GOOGLE_TAXONOMY_URL =
  "https://www.google.com/basepages/producttype/taxonomy-with-ids.en-US.txt";

const TOY_FIGURES: GoogleProductCategory = {
  id: "6058",
  path: "Toys & Games > Toys > Dolls, Playsets & Toy Figures > Action & Toy Figures",
};

/** ジャンル → GPC。null は「意図的に category を出さない」（＝中身が一意に決まらない）。 */
export const GENRE_TO_GOOGLE_CATEGORY: Record<string, GoogleProductCategory | null> = {
  フィギュア: TOY_FIGURES,
  // ソフビ・アートトイも Google の分類ではフィギュア（可動/非可動の別は GPC に無い）。
  "ソフビ・アートトイ": TOY_FIGURES,
  トレカ: {
    id: "6997",
    path: "Arts & Entertainment > Hobbies & Creative Arts > Collectibles > Collectible Trading Cards",
  },
  スニーカー: { id: "187", path: "Apparel & Accessories > Shoes" },
  プラモ: {
    id: "4175",
    path: "Arts & Entertainment > Hobbies & Creative Arts > Model Making > Scale Model Kits",
  },
  // トミカ/プラレール/ベイブレード等の「遊べる玩具」。細目は商品ごとに違うので親の Toys 止まり。
  玩具: { id: "1253", path: "Toys & Games > Toys" },
  "酒・ウイスキー": {
    // ウイスキー以外（ビール・日本酒・リキュール）も入る枠なので Liquor & Spirits ではなく親。
    id: "499676",
    path: "Food, Beverages & Tobacco > Beverages > Alcoholic Beverages",
  },

  // ── ここから下は意図的に付けない ─────────────────────────────
  // くじは1つの商品ページの中にフィギュア・タオル・食器が同居する（等賞ごとに別物）。
  一番くじ: null,
  くじ: null,
  // コラボはグッズ・カフェ・ポップアップが混ざる。物ですらない行がある。
  コラボ: null,
  // 「ポケモン」はIP名であってカテゴリではない（中身はカード・ぬいぐるみ・ゲーム）。
  ポケモン: null,
  // ぬいぐるみ・アクスタ・雑貨が同居。GPC はこの粒度を持たない。
  キャラグッズ: null,
  // 家電とゲーム機で別カテゴリになるものを1ジャンルにまとめている枠。
  "家電・ゲーム機": null,
  // 映像（DVD/Blu-ray）と音楽（CD）で別カテゴリ。
  "映像・音楽": null,
  その他: null,
};

/** そのジャンルで構造化データに出してよい GPC。出さない場合は null。 */
export function googleProductCategory(genre: string): GoogleProductCategory | null {
  return GENRE_TO_GOOGLE_CATEGORY[genre] ?? null;
}

/**
 * Product.category に入れる値。GPC が決まるジャンルだけ
 * 「CategoryCode（Googleが読む） + 日本語ジャンル名（独自カテゴリ）」の配列で出す。
 * 決まらないジャンルは undefined ＝ プロパティごと出さない（無効値を出すより無い方が正しい）。
 */
export function productCategoryValue(genre: string) {
  const gpc = googleProductCategory(genre);
  if (!gpc) return undefined;
  return [
    { "@type": "CategoryCode", inCodeSet: GOOGLE_TAXONOMY_URL, codeValue: gpc.id },
    genre,
  ];
}
