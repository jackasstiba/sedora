import { ScrapedItem } from "./types";
import {
  parseDatedCollectionHandle,
  scrapeCharaShopifyStore,
  type DatedCollection,
} from "./shopifyCharaStore";

// ちいかわマーケット（公式グッズショップ）＝**ちいかわの一次情報**。
//
// なぜ足したか（2026-08-18 実測）: 本番3512件に「ちいかわ」は29件あったが、**全部が
// まとめ記事・コラボ記事経由**（figisland/channeltono/collabo_cafe/koretore）で、
// 公式ショップの発売・再入荷そのものは1件も無かった。ちいかわは発売即完売→二次流通が
// 常時動く定番なので、「何が・いつ・定価いくらで出るか」を一次で持っていないのは痛い。
//
// 取得方式: Shopify の公開商品JSON（/collections/<handle>/products.json）。
// テーマのclass名を追うより壊れにくく、価格・在庫・タグ・画像が構造化されたまま取れる。
//
// 2026-08-21: 同じ「日付別コレクション」運用の姉妹店（ナガノマーケット・mofusand）へ
// 横展開するため、取り方の本体は shopifyCharaStore.ts に移した。ここは設定と、
// selftest が固定している純関数の名前を残す。
//
// 【掲載方針】url は公式ショップの商品ページ（一次情報）＝直リンクしてよい。

const STORE = "https://www.chiikawamarket.jp";

export type ChiikawaCollection = DatedCollection;

/** コレクション名を「種別＋日付」に読み替える（純関数・selftest対象）。 */
export function parseChiikawaCollection(handle: string): ChiikawaCollection | null {
  return parseDatedCollectionHandle(handle);
}

/**
 * 商品タイプをサイトのジャンル語彙に寄せる。
 *
 * `classifyGenre()` は「ぬいぐるみ」を**フィギュア**に倒すが、ここは全件が
 * キャラクターグッズなので、フィギュア/ソフビだけを分けて残りはキャラグッズに置く。
 * （語彙は itemFilter.ts の GENRE_ORDER が唯一の定義。無い名前を作らない）
 */
export function chiikawaGenre(productType: string, title: string): string {
  const t = `${productType} ${title}`;
  if (/ソフビ/.test(t)) return "ソフビ・アートトイ";
  if (/フィギュア/.test(t)) return "フィギュア";
  if (/カード|ブックマーク/.test(productType) && /トレーディング/.test(title)) return "キャラグッズ";
  return "キャラグッズ";
}

export async function scrapeChiikawaMarket(): Promise<ScrapedItem[]> {
  // sourceId はちいかわマーケットの handle（＝JANそのもの）＝安定キー。
  return scrapeCharaShopifyStore({
    source: "chiikawa_market",
    store: STORE,
    keepDaysAfterRelease: 0,
    genre: chiikawaGenre,
  });
}
