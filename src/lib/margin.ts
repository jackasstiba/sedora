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

/** 差益を計算。定価が読めない/相場が無い/比が安全域外なら null（＝差益は表示しない）。 */
export function computeMargin(
  price: string | null | undefined,
  marketPrice: number | null | undefined
): Margin | null {
  const teika = parseYen(price);
  if (!teika || !marketPrice || marketPrice <= 0) return null;
  const ratio = marketPrice / teika;
  if (ratio > MAX_RATIO || ratio < MIN_RATIO) return null;
  const diff = marketPrice - teika;
  const pct = Math.round((diff / teika) * 100);
  return { teika, market: marketPrice, diff, pct, isPremium: diff > 0 };
}

/** "+46%" / "-12%" */
export function formatPct(pct: number): string {
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

/** "+¥411" / "-¥120" */
export function formatDiff(diff: number): string {
  return `${diff >= 0 ? "+" : "-"}¥${Math.abs(diff).toLocaleString("ja-JP")}`;
}
