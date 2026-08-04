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

/** "7/25(土)"。ただし今年(日本時間基準)以外は年を付けて "2027/7/28(水)"。
 *  年を省くと、来年の日付が今年の間に紛れて「順番がおかしい」ように見えるため。 */
export function formatShort(d: Date | string): string {
  const x = new Date(d);
  const y = x.getUTCFullYear();
  const md = `${x.getUTCMonth() + 1}/${x.getUTCDate()}(${DAYS[x.getUTCDay()]})`;
  return y === todayJst().getUTCFullYear() ? md : `${y}/${md}`;
}

/** "2026年7月25日(土)" */
export function formatLong(d: Date | string): string {
  const x = new Date(d);
  return `${x.getUTCFullYear()}年${x.getUTCMonth() + 1}月${x.getUTCDate()}日(${DAYS[x.getUTCDay()]})`;
}

/** 対象の暦日が「今日（日本時間）」から何日後か。負=過去、0=本日、正=未来。UTC暦日で比較。 */
export function daysUntil(d: Date | string): number {
  const x = new Date(d);
  const target = Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
  return Math.round((target - todayJst().getTime()) / 86_400_000);
}

export type Countdown = {
  days: number;
  /** 表示ラベル。"本日" / "明日" / "あと3日"。eventDate から計算できる事実のみ（「締切」等の未確定語は使わない）。 */
  text: string;
  /** 緊急度。urgent=本日/明日, soon=2〜3日, week=4〜7日。8日以上・過去は null（＝バッジを出さない）。 */
  tone: "urgent" | "soon" | "week";
};

/** 発売・予約開始・抽選・開催などの eventDate から「あと何日か」を返す。
 *  近日（7日以内）だけを緊急シグナルとして返し、それより先・過去・日付なしは null。
 *  eventType 非依存の事実（残日数）のみを扱い、締切/開始の断定はしない（呼び出し側で eventType バッジと併記）。 */
export function countdown(eventDate: Date | string | null): Countdown | null {
  if (!eventDate) return null;
  const days = daysUntil(eventDate);
  if (days < 0 || days > 7) return null;
  const text = days === 0 ? "本日" : days === 1 ? "明日" : `あと${days}日`;
  const tone: Countdown["tone"] = days <= 1 ? "urgent" : days <= 3 ? "soon" : "week";
  return { days, text, tone };
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

/** 実時刻（scrapedAt 等のタイムスタンプ）を日本時間で "2026/7/28 9:09" に整形する。
 *  ※ 発売日などの「暦日」ではなく、実際の瞬間を表す値に使う。
 *  toLocaleString は timeZone 未指定だと実行環境のTZ（本番Vercel=UTC）になり、
 *  JST早朝に走ったスクレイプ(UTCでは前日夜)が「最終更新 前日」に見えてしまう。
 *  必ず Asia/Tokyo を指定して、どのサーバーでも日本時間で表示する。 */
export function formatDateTimeJst(d: Date | string): string {
  return new Date(d).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const WEEKDAY_LABELS = DAYS;
