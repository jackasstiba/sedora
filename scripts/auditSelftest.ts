/**
 * 監査の自己テスト（`npm run audit:selftest`）。**検査が本当に鳴るのかを確かめる。**
 *
 * なぜ要るか: 検査は本番を壊さないので、間違っていても咎められずに残る。
 * 実測で何度も踏んだ2つの失敗が、どちらも「出力を見れば分かった」ものだった。
 *   ・**発火しようのない検査を持っているだけ**（セレクタが壊れて0枚を見て「0件」と報告）
 *   ・**誤報**（HEAD/GETの違い・曖昧な日付正規表現・データ層と表示層のズレ／計4回）
 * 本番データに対する「0件」は、鳴るべき入力で鳴ることを別に示さないと意味が無い。
 * ここは**合成した入力**に対して、鳴る／鳴らないの両方を固定する。
 *
 * 実際にこのテストは、書いた直後の displayEventType のバグを1つ捕まえた:
 * 未知の「エントリー受付中」まで「予約終了」に書き換えていた（予約ではないのに予約と断定）。
 */
import { displayEventType, isStalePromise, isStalePlan, plannedDateFromText } from "../src/lib/date";

const today = new Date(Date.UTC(2026, 7, 8)); // 2026-08-08 固定（今日に依存させない）
const PAST = "2023年4月発送予定";
const FUTURE = "2027年4月発送予定";
const THIS_MONTH = "2026年8月発送予定"; // 月精度は月末に倒すので「まだ過ぎていない」

type Case = { name: string; fn: () => unknown; want: unknown };

const cases: Case[] = [
  // ── 期限切れの約束ラベル ────────────────────────────────
  // 知っているラベルは表示層で過去形に直す＝検査は鳴らない
  { name: "予約受付中・過去 → 表示が予約終了", fn: () => displayEventType("予約受付中", null, PAST, today), want: "予約終了" },
  { name: "予約受付中・過去 → 検査は鳴らない", fn: () => isStalePromise("予約受付中", null, PAST, today), want: false },
  { name: "登場予定・過去 → 表示が登場済み", fn: () => displayEventType("登場予定", null, PAST, today), want: "登場済み" },
  // 未来・当月は触らない（巻き込み防止。実測で2回間違えた箇所）
  { name: "予約受付中・未来 → そのまま", fn: () => displayEventType("予約受付中", null, FUTURE, today), want: "予約受付中" },
  { name: "予約受付中・当月 → そのまま（月末に倒す）", fn: () => displayEventType("予約受付中", null, THIS_MONTH, today), want: "予約受付中" },
  { name: "予約開始・過去 → そのまま（受付が始まった、の意味）", fn: () => displayEventType("予約開始", null, PAST, today), want: "予約開始" },
  // 知らないラベルは**書き換えず、検査に出す**（勝手な断定を足さない）
  { name: "未知『販売予定』・過去 → 書き換えない", fn: () => displayEventType("販売予定", null, PAST, today), want: "販売予定" },
  { name: "未知『販売予定』・過去 → 検査が鳴る", fn: () => isStalePromise("販売予定", null, PAST, today), want: true },
  { name: "未知『エントリー受付中』・過去 → 検査が鳴る", fn: () => isStalePromise("エントリー受付中", null, PAST, today), want: true },
  { name: "未知『販売予定』・未来 → 鳴らない", fn: () => isStalePromise("販売予定", null, FUTURE, today), want: false },
  // 約束でないラベルは対象外（発売済みは相場の価値がある＝落としても書き換えてもいけない）
  { name: "発売・過去 → 鳴らない", fn: () => isStalePromise("発売", null, PAST, today), want: false },
  { name: "開催・過去 → 鳴らない", fn: () => isStalePromise("開催", null, PAST, today), want: false },

  // ── 日付の読み方（過去に2回誤読した書式を固定する） ──────────
  { name: "「2026年08月下旬」は月末に倒す", fn: () => plannedDateFromText("2026年08月下旬登場予定")?.toISOString().slice(0, 10), want: "2026-08-31" },
  { name: "「2026年08月05週」を8月5日と読まない", fn: () => plannedDateFromText("2026年08月05週登場予定")?.toISOString().slice(0, 10), want: "2026-08-29" },
  { name: "未来を約束しない文は判定しない", fn: () => plannedDateFromText("2026年8月6日に発売しました"), want: null },
  { name: "日付未定の過ぎた予定は落とす", fn: () => isStalePlan(null, "2026年06月04週登場予定", today), want: true },
  { name: "日付未定の未来の予定は残す", fn: () => isStalePlan(null, "2026年09月下旬登場予定", today), want: false },
];

let ng = 0;
for (const c of cases) {
  const got = c.fn();
  const ok = got === c.want;
  if (!ok) ng++;
  console.log(`${ok ? "OK " : "NG "} ${c.name}${ok ? "" : `\n     got=${JSON.stringify(got)} want=${JSON.stringify(c.want)}`}`);
}
console.log(`\n==== 監査の自己テスト: ${cases.length}件中 ${ng}件が期待と違う ====`);
process.exit(ng === 0 ? 0 : 1);
