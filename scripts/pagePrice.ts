/**
 * ページの JSON に載っている価格（円）を集める（純関数・副作用なし＝selftest から呼べる）。
 *
 * なぜ本文と別に要るか（2026-08-24 実測）: `auditFacts` の `pageText` は script を落としてから
 * 本文を見るので、**価格の正本ごと捨てている**ことがある。ちいかわマーケット（Shopify）の
 * 商品ページは価格を本文の文字として持たず、埋め込みJSONの `"price":55000`（**銭**単位）だけが持つ。
 * その結果「掲載価格 550円 が本文に無い」という**嘘の指摘が11件**上がっていた
 * （実物を開いて確認: og:title も商品名も一致し、Shopify の price 55000 = 550円 ＝**掲載が正しい**）。
 * 誤検知が積もると本物の食い違いがその中に埋もれるので、読める形は読む。
 *
 * 📌 これは 2026-08-22 に記録した「Shopify の価格は一覧(products.json)が円・単品(.js)が銭。
 *    取り違えると100倍になる」の罠に、今度は**検査側**がはまっていた形。
 *
 * 銭として読むのは**そのページが実際に Shopify だと名乗っているとき**だけ。
 * ホストの allowlist は作らない（2026-08-22 の方針＝長い尾に効かなくなる）。
 * この条件が無いと、55,000円の商品を 550円 として黙って受け入れてしまう。
 */
export function jsonPrices(rawHtml: string): Set<number> {
  const out = new Set<number>();
  const isShopify = /cdn\/shop\/|Shopify\.shop|"shopify"/i.test(rawHtml);
  for (const m of rawHtml.matchAll(/"price"\s*:\s*"?(\d+(?:\.\d+)?)"?/g)) {
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n <= 0) continue;
    out.add(Math.round(n)); // JSON-LD 等は円
    if (isShopify && n % 100 === 0) out.add(n / 100); // Shopify の商品JSONは銭
  }
  return out;
}
