// 発売日・開催日は「時刻を持たない暦日」として扱う。
//
// 以前は new Date(年, 月-1, 日) でローカル時刻（スクレイパー実行環境=JST）の0時として
// 保存していたため、UTCで動く本番サーバー(Vercel)で読むと1日前になり、
// サイト全体の日付が1日ズレていた。
//
// 対策として、暦日は必ず「その日のUTC 0時」として保存し、表示・比較も UTC 系の
// ゲッターで行う。これで実行環境のタイムゾーンに関係なく同じ日付になる。

const DAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** 年月日から「暦日」を作る（UTC 0時固定） */
export function calendarDate(year: number, month1: number, day: number): Date {
  return new Date(Date.UTC(year, month1 - 1, day));
}

/** 日本時間での「今日」を暦日（UTC 0時）で返す。過去判定の基準に使う。 */
export function todayJst(): Date {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()));
}

/** "7/25(土)" */
export function formatShort(d: Date | string): string {
  const x = new Date(d);
  return `${x.getUTCMonth() + 1}/${x.getUTCDate()}(${DAYS[x.getUTCDay()]})`;
}

/** "2026年7月25日(土)" */
export function formatLong(d: Date | string): string {
  const x = new Date(d);
  return `${x.getUTCFullYear()}年${x.getUTCMonth() + 1}月${x.getUTCDate()}日(${DAYS[x.getUTCDay()]})`;
}

/** 暦日の年・月・日・曜日（UTC基準） */
export function parts(d: Date | string): { y: number; m: number; day: number; dow: number } {
  const x = new Date(d);
  return {
    y: x.getUTCFullYear(),
    m: x.getUTCMonth() + 1,
    day: x.getUTCDate(),
    dow: x.getUTCDay(),
  };
}

export const WEEKDAY_LABELS = DAYS;
