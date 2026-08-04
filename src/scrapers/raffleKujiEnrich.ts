// raffle-kuji.jp のくじ詳細ページ（/lotteries/[id]）から、せどらーが知りたい
// 「抽選1回の金額」と「賞品ラインナップ」を抽出する純関数。
//
// 一覧スクレイパー(raffleKuji.ts)はタイトル・締切・画像しか取れず、“いくらで引けるか／
// 何が当たるか”に届かない（＝「情報が浅い」）。詳細ページ本文はSSR済みで、
//   LotteryDetailHeader_drawFeeText__* … 「1回 770円（税込）」
//   LotteryPrizeList_itemName__*        … 賞品名（先頭ほど当選確率が低い＝高額側）
// が構造化されているので、これを price と highlights に落とす。
//
// 一番くじ(ichibanKujiEnrich)と役割は同じだが、raffle-kuji は賞に等級(A賞/B賞)が無く
// 賞品名の並びだけなので、賞ギャラリー(prizes JSON)は使わず賞品名の羅列に留める
// （＝一番くじ専用の「各賞ラインナップ」ギャラリーの等級前提コピーと食い違わせない）。

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function strip(s: string): string {
  return decodeEntities(s)
    .replace(/<[^>]+>/g, "")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 「1回 770円（税込）」等、抽選1回の金額テキストを返す。数字が無ければ null。 */
export function extractDrawFee(html: string): string | null {
  const m = html.match(/LotteryDetailHeader_drawFeeText__[^"]*">([\s\S]*?)<\//);
  if (!m) return null;
  const t = strip(m[1]);
  return /\d/.test(t) ? t : null;
}

/** 賞品名の一覧（先頭＝当選確率が低い高額側）。重複除去。取れなければ空配列。 */
export function extractRafflePrizeNames(html: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/LotteryPrizeList_itemName__[^"]*">([\s\S]*?)<\//g)) {
    const n = strip(m[1]);
    if (n && !seen.has(n)) {
      seen.add(n);
      names.push(n);
    }
  }
  return names;
}

/** 賞品名を highlights 用の1行要約にする（カード＆詳細の「🎯 注目賞品」枠で共有）。 */
export function formatRafflePrizeHighlights(names: string[]): string | null {
  if (!names.length) return null;
  return `賞品ラインナップ：${names.join(" ／ ")}（全${names.length}種）`;
}
