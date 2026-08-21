import { ScrapedItem } from "./types";
import { scrapeCharaShopifyStore } from "./shopifyCharaStore";

// ナガノマーケット（ナガノキャラクターズ公式グッズショップ）＝**ちいかわマーケットの姉妹店**
// （同じ作者ナガノ氏の「ナガノのくま」「もぐらコロッケ」等。運用も同じ日付別コレクション方式
// だと2026-08-21に実測: トップに pre20260826 / 20260807 / re20260807、newitems・restock あり）。
//
// ちいかわ同様、発売即完売→二次流通が動く定番（実測: 予約中のハッピーバッグ2027が
// 掲載初日から品切れ表示）。「何が・いつ・定価いくらで出るか」を一次で持つ。
//
// 【掲載方針】url は公式ショップの商品ページ（一次情報）＝直リンクしてよい。

export async function scrapeNaganoMarket(): Promise<ScrapedItem[]> {
  return scrapeCharaShopifyStore({
    source: "nagano_market",
    store: "https://nagano-market.jp",
    keepDaysAfterRelease: 0,
  });
}
