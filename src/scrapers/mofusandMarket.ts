import { ScrapedItem } from "./types";
import { scrapeCharaShopifyStore } from "./shopifyCharaStore";

// mofusand もふもふマーケット（公式グッズショップ）＝**mofusandの一次情報**。
// ぢゅの氏のサメにゃん等、発売即完売→二次流通が常時動くキャラクターEC。
//
// 2026-08-21 実測: ちいかわマーケットと同じ「日付別コレクション」運用
// （トップに 20260821 / pre20260807、suffix型 20251010re や枝番 20251128-2 も使う。
// newitems・restock コレクションあり）。取り方は shopifyCharaStore.ts に共通化。
//
// 【掲載方針】url は公式ショップの商品ページ（一次情報）＝直リンクしてよい。

export async function scrapeMofusandMarket(): Promise<ScrapedItem[]> {
  return scrapeCharaShopifyStore({
    source: "mofusand_market",
    store: "https://mofusand-mofumofu-market.jp",
    keepDaysAfterRelease: 0,
  });
}
