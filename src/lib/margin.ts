// 定価(price文字列)と相場(marketPrice:Int)から「定価比の差益」を計算する。prisma非依存の純関数。
// せどらーが最も見たいのは「定価に対して相場がどれだけ上か（＝プレ値か）」なので、
// 相場が付いている商品には定価との乖離を出す。

/**
 * "¥18,700" / "2,970円(税込)" / "200円（税込）" 等から定価(円・整数)を取り出す。
 * 価格文字列中で最大の数値を採用（"1BOX(20パック)¥3,960" のような紛れに強い）。
 */
export function parseYen(price: string | null | undefined): number | null {
  if (!price) return null;
  const nums = price.replace(/[，,]/g, "").match(/\d{2,7}/g);
  if (!nums) return null;
  const max = Math.max(...nums.map(Number));
  return Number.isFinite(max) && max > 0 ? max : null;
}

/**
 * トレカ系で「単パック表記なのにBOX級の価格」の疑い（audit の価格検査と同じ観点）。
 * 2026-08-15 実測: トレカ速報の一部商品（WS anemoi 52,800円等）は、同シリーズの他商品が
 * 【10パック入りBOX】を明記する中で販売単位の表記が無く、価格が定価ともBOX価格とも
 * 裏取りできない。裏取りできない価格は表示しない（[[UIラベルは裏取り済みのみ約束]]）。
 */
export function isSuspectPackPrice(genre: string | null, title: string, price: string | null): boolean {
  if (!price) return false;
  const y = parseYen(price.split(" / ")[0]);
  if (y == null || y < 3000) return false;
  if (genre !== "トレカ" && genre !== "ポケモン") return false;
  const isBoxWord = /BOX|ＢＯＸ|box|箱|入り|カートン|セット/.test(title);
  return /(?:ブースター|スターター)?パック/.test(title) && !isBoxWord;
}

export type Margin = {
  teika: number; // 定価
  market: number; // 相場(中古)
  diff: number; // market - teika（正＝プレ値）
  pct: number; // 定価比(%)
  isPremium: boolean; // 相場が定価より高い＝プレ値
};

// 定価と相場の単位ズレ・誤データを弾く安全域。
// 例: ポケカ「拡張パック」定価(1パック¥200) vs 相場(BOX中古¥11,800)は桁違いで比較不能なので
// 差益を出すと "+5800%" のような無意味な数字になる。安全域外は差益を表示しない（相場のみ出す）。
const MAX_RATIO = 10; // 相場が定価の10倍超 → 単位ズレ/異常とみなす
const MIN_RATIO = 0.05; // 相場が定価の1/20未満 → 同上

/**
 * price が「1回いくら」＝**くじ1回の参加費**か（"1回 850円（税込）"）。
 *
 * これは商品の定価ではない。850円払って当たるのは全13賞のどれか1つで、相場が付いているのは
 * その中の特定の1賞。両者を割ると「+800%」のような、引けば必ず儲かるように読める数字が出る。
 * 期待値は賞ごとの本数が分からないと出せない（こちらは持っていない）ので、**出さない**。
 */
export function isPerDrawFee(price: string): boolean {
  return /\d\s*回\s*[¥￥]?\s*[\d，,]+\s*円/.test(price) || /^\s*1\s*回/.test(price);
}

/** 差益を計算。定価が読めない/相場が無い/比が安全域外なら null（＝差益は表示しない）。 */
export function computeMargin(
  price: string | null | undefined,
  marketPrice: number | null | undefined
): Margin | null {
  if (price && isPerDrawFee(price)) return null;
  const teika = parseYen(price);
  if (!teika || !marketPrice || marketPrice <= 0) return null;
  const ratio = marketPrice / teika;
  if (ratio > MAX_RATIO || ratio < MIN_RATIO) return null;
  const diff = marketPrice - teika;
  const pct = Math.round((diff / teika) * 100);
  return { teika, market: marketPrice, diff, pct, isPremium: diff > 0 };
}

/**
 * 価格の表記ゆれを表示用に統一する（非破壊・DB値はそのまま）。
 * ・"¥1,234" → "1,234円"（大多数の源が円表記なので円に寄せる）
 * ・半角の税表記 "(税込)" → 全角 "（税込）"
 * 例: "¥18,700" → "18,700円" ／ "2,970円(税込)" → "2,970円（税込）"
 */
export function formatPriceDisplay(price: string | null | undefined): string | null {
  if (!price) return null;
  return price
    .trim()
    .replace(/¥\s*([\d，,]+)/g, "$1円")
    .replace(/\(税(込|抜|別)\)/g, "（税$1）");
}

/** "+46%" / "-12%" */
export function formatPct(pct: number): string {
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

/** "+¥411" / "-¥120" */
export function formatDiff(diff: number): string {
  return `${diff >= 0 ? "+" : "-"}¥${Math.abs(diff).toLocaleString("ja-JP")}`;
}
