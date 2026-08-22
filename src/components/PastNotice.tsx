import type { PastNotice } from "@/lib/date";

/**
 * 「この情報は過去のものです」ブロック。**残っているページが過去だと言うための表示。**
 *
 * サウナイキタイの【閉店】表示に倣う（終わったものを消さず、告知ブロックを付けて残す）。
 * 判定と文言は src/lib/date.ts の `pastNotice` が持つ＝ここは描くだけ（判定を二重に書かない）。
 *
 * `data-past-notice` は **監査（scripts/auditRendered.ts）が配信HTMLから見つける目印**。
 * 見た目のクラス名で探すと、色を変えた日に検査が静かに 0件になる。
 */
export function PastNoticeBox({
  notice,
  dateLabel,
}: {
  notice: PastNotice;
  /** 画面に出している日付（「2026年8月6日(木)」）。分かっている行だけ添える。 */
  dateLabel?: string | null;
}) {
  // 断定の強さと見た目の強さを揃える。言い切れる ended だけ色を付け、
  // 「終わったか分からない」ものを終了っぽい赤で塗らない。
  const strong = notice.kind === "ended";
  return (
    <div
      data-past-notice={notice.kind}
      className={`mb-5 rounded-xl border px-4 py-3 ${
        strong
          ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40"
          : "border-neutral-300 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900"
      }`}
    >
      <p
        className={`text-sm font-bold ${
          strong
            ? "text-amber-900 dark:text-amber-200"
            : "text-neutral-800 dark:text-neutral-100"
        }`}
      >
        ⏳ {notice.headline}
        {dateLabel && (
          <span className="ml-1 font-normal">（掲載日: {dateLabel}）</span>
        )}
      </p>
      <p
        className={`mt-1 text-xs ${
          strong
            ? "text-amber-800/90 dark:text-amber-300/90"
            : "text-neutral-600 dark:text-neutral-400"
        }`}
      >
        {notice.detail}
      </p>
    </div>
  );
}

/** 英語版（/en/items/*）。判定は同じ `pastNotice` の kind を使い、文言だけ i18n から受け取る。 */
export function PastNoticeBoxEn({
  kind,
  headline,
  detail,
  dateLabel,
}: {
  kind: PastNotice["kind"];
  headline: string;
  detail: string;
  dateLabel?: string | null;
}) {
  const strong = kind === "ended";
  return (
    <div
      data-past-notice={kind}
      className={`mb-5 rounded-xl border px-4 py-3 ${
        strong
          ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40"
          : "border-neutral-300 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900"
      }`}
    >
      <p
        className={`text-sm font-bold ${
          strong ? "text-amber-900 dark:text-amber-200" : "text-neutral-800 dark:text-neutral-100"
        }`}
      >
        ⏳ {headline}
        {dateLabel && <span className="ml-1 font-normal">(listed date: {dateLabel})</span>}
      </p>
      <p
        className={`mt-1 text-xs ${
          strong ? "text-amber-800/90 dark:text-amber-300/90" : "text-neutral-600 dark:text-neutral-400"
        }`}
      >
        {detail}
      </p>
    </div>
  );
}
