// 月別ページ用のカレンダー表示。日ごとの発売件数を可視化し、その日の一覧へ飛ぶ。
// サーバーコンポーネント（表示のみ、状態なし）。

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export function MonthCalendar({
  month,
  counts,
}: {
  month: string; // "2026-08"
  counts: Record<number, number>; // 日 -> 件数
}) {
  const m = month.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const monthIdx = Number(m[2]) - 1;

  // 暦日は UTC 基準で計算（保存値・表示と揃える）
  const startDow = new Date(Date.UTC(year, monthIdx, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();

  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="mb-8 overflow-x-auto">
      <div className="grid min-w-[22rem] grid-cols-7 gap-1 text-center text-xs">
        {WEEKDAYS.map((w, i) => (
          <div
            key={w}
            className={`py-1 font-semibold ${
              i === 0 ? "text-rose-500" : i === 6 ? "text-blue-500" : "text-neutral-500"
            }`}
          >
            {w}
          </div>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <div key={`e${i}`} />;
          const count = counts[d] ?? 0;
          const dow = i % 7;
          const dayColor = dow === 0 ? "text-rose-500" : dow === 6 ? "text-blue-500" : "";
          if (count === 0) {
            return (
              <div
                key={d}
                className={`rounded-md border border-transparent py-2 text-neutral-400 ${dayColor}`}
              >
                {d}
              </div>
            );
          }
          return (
            <a
              key={d}
              href={`#day-${d}`}
              className="flex flex-col items-center gap-0.5 rounded-md border border-rose-200 bg-rose-50 py-1.5 transition hover:border-rose-400 dark:border-rose-900/50 dark:bg-rose-950/30"
            >
              <span className={`font-semibold text-neutral-800 dark:text-neutral-100 ${dayColor}`}>
                {d}
              </span>
              <span className="rounded-full bg-rose-600 px-1.5 text-[10px] font-bold text-white">
                {count}
              </span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
