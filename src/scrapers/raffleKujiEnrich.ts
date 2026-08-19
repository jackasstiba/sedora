// raffle-kuji.jp のくじ詳細ページ（/lotteries/[id]）から、せどらーが知りたい
// 「抽選1回の金額」と「賞品ラインナップ」を抽出する純関数。
//
// 一覧スクレイパー(raffleKuji.ts)はタイトル・締切・画像しか取れず、“いくらで引けるか／
// 何が当たるか”に届かない（＝「情報が浅い」）。詳細ページ本文はSSR済みで、
//   LotteryDetailHeader_drawFeeText__* … 「1回 770円（税込）」
//   LotteryPrizeList_itemName__*        … 賞品名（先頭ほど当選確率が低い＝高額側）
// が構造化されているので、これを price と highlights に落とす。
//
// 一番くじ(ichibanKujiEnrich)と役割は同じだが、raffle-kuji は賞に等級(A賞/B賞)が無い。
// 代わりに各賞に当選確率(例「0.5%」＝先頭ほど低確率＝本命)と賞品画像があるので、
// 賞ギャラリー(prizes JSON)には label=当選確率・name=賞品名・image=賞品画像 を入れる。
// 詳細ページ側のギャラリーは label が「賞」で終わるか(=一番くじ)否か(=raffle)で見せ方を出し分ける。

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

/**
 * 受付期間（"2026年08月19日 03:00 ~ 2026年09月01日 08:59"）と、その終わりの暦日を返す。
 *
 * なぜ個別ページを読むのか（2026-08-19 実測・6件すべてで再現）: 一覧カードの締切は
 * **「2026年08月31日 23:59 まで」なのに、個別ページの受付期間は「~ 2026年09月01日 08:59」**。
 * 収集元の中で9時間ぶんズレていて、一覧だけを信じると**まだ応募できる朝を「締切済み」と
 * 表示する**。応募の可否を決めるのは応募ページ側の期間なので、そちらを正とする。
 */
export function extractRafflePeriod(html: string): { text: string; end: Date } | null {
  const m = strip(html).match(
    /(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}:\d{2})\s*[~〜～]\s*(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}:\d{2})/
  );
  if (!m) return null;
  return {
    text: `${m[1]}年${m[2]}月${m[3]}日 ${m[4]} ~ ${m[5]}年${m[6]}月${m[7]}日 ${m[8]}`,
    end: new Date(Date.UTC(Number(m[5]), Number(m[6]) - 1, Number(m[7]))),
  };
}

export type RafflePrize = { label: string; name: string; image: string | null };

/**
 * 各賞（賞品カード）を {label:当選確率, name:賞品名, image:賞品画像} で構造化する。
 * 先頭ほど当選確率が低い＝高額の本命。取れなければ空配列（＝深掘り失敗、呼び出し側は活かす）。
 */
export function extractRafflePrizes(html: string): RafflePrize[] {
  // 賞品カードは `LotteryPrizeList_itemCard__*` 単位（Benefit等の別リストは別クラスなので混ざらない）。
  const cards = html.split(/LotteryPrizeList_itemCard__[A-Za-z0-9_]+/).slice(1);
  const out: RafflePrize[] = [];
  const seen = new Set<string>();
  for (const c of cards) {
    const rawName = c.match(/LotteryPrizeList_itemName__[^"]*">([\s\S]*?)<\//)?.[1];
    const name = rawName ? strip(rawName) : "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    // 当選確率（「当選確率: 0.5%」）。React の `<!-- -->` で数字が分断されるので、
    // status ブロックを strip（タグ/コメント/nbsp除去）してからマッチする。半角/全角％対応。
    const statusRaw = c.match(/LotteryPrizeList_statusWrapper__[^"]*">([\s\S]*?)<\/div>/)?.[1];
    const prob = statusRaw
      ? strip(statusRaw).match(/([\d.]+\s*[%％])/)?.[1]?.replace(/\s+/g, "")
      : undefined;
    const image =
      c.match(/<img src="(https:\/\/s\.butterfly\.fan\/lottery-prize-goods\/[^"]+)"/)?.[1] ?? null;
    out.push({ label: prob || "賞品", name, image });
  }
  return out;
}

/** 賞品名を highlights 用の1行要約にする（カード＆詳細の「🎯 注目賞品」枠で共有）。 */
export function formatRafflePrizeHighlights(prizes: RafflePrize[]): string | null {
  if (!prizes.length) return null;
  return `賞品ラインナップ：${prizes.map((p) => p.name).join(" ／ ")}（全${prizes.length}種）`;
}
