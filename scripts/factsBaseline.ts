/**
 * 一次情報の突合（audit:facts / audit:links）の**基準に書いてよい回か**の判定。
 *
 * auditFacts.ts は末尾で main() を呼ぶ＝import しただけで監査が丸ごと走るので、
 * 検査から触れるように純関数だけをここに分けてある。
 */
export const BASELINE_MAX_UNREADABLE = 0.2;

/**
 * 読めなかった割合が高い回は**痩せている**。「要確認が減った」に見えても、
 * 直ったのではなく読めなかっただけなので基準にしない。
 */
export function baselineWritable(checked: number, unusable: number): { ok: boolean; rate: number } {
  const total = checked + unusable;
  const rate = total > 0 ? unusable / total : 0;
  return { ok: rate <= BASELINE_MAX_UNREADABLE, rate };
}
