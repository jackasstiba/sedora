// 発売日・開催日は「時刻を持たない暦日」として扱う。
//
// 以前は new Date(年, 月-1, 日) でローカル時刻（スクレイパー実行環境=JST）の0時として
// 保存していたため、UTCで動く本番サーバー(Vercel)で読むと1日前になり、
// サイト全体の日付が1日ズレていた。
//
// 対策として、暦日は必ず「その日のUTC 0時」として保存し、表示・比較も UTC 系の
// ゲッターで行う。これで実行環境のタイムゾーンに関係なく同じ日付になる。

const DAYS = ["日", "月", "火", "水", "木", "金", "土"];
// 英語版（/en）の表示・画面監査で使う。表記は audit:page の突合が読める形に固定する。
const DAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ── 壁時計を読むのは、このファイルの中だけ ──────────────────────────────
//
// 2026-08-16 に日付の事故を2日連続で起こした（ミス23・ミス24）。原因はどちらも
// 「いま何日か」を各所がバラバラに求めていたこと:
//  ・`new Date()` の **UTC暦日** を今日とみなす実装が cardChusen.ts にあり、
//    **日本時間 09:00 より前に巡回した回だけ**すべての締切が1日早く解決されていた
//    （実測 06:39 JST の巡回で 197枠中93枠＝47%）。昼に動かすと再現しないので、
//    「たまたま朝に回した日だけサイトが嘘をつく」状態だった。
//  ・「日本時間の今日」を求める +9h のコードが **6箇所にコピーされていた**
//    （date.ts / cardChusen.ts / nyukaNow.ts / raffleKuji.ts / tenbaiquest.ts /
//    backfillDisplayText.ts）。1つ直しても他が残る。
//
// 結論: **時計を読む行はここにしか置かない。** 他のファイルは下の3つを名前で呼ぶ。
// 名前がそのまま「どの種類の値か」の宣言になる（暦日なのか、瞬間なのか）。
//  ・todayJst()    … 日本時間の「今日」（時刻を持たない暦日）
//  ・jstCalDate(ms)… 任意の瞬間 → 日本時間の暦日
//  ・nowInstant()  … 「瞬間」（scrapedAt・ログの時刻）。暦日ではない
// この規約は文章ではなく機械で守る:
//  ・`npm run audit` の `clock_discipline` … 他ファイルの `new Date()` / `Date.now()` /
//    ローカル時刻ゲッター（getFullYear 等）を ERROR にする（＝書いた時点で落ちる）
//  ・`npm run audit:clock` … 同じ日本時間の日を、時刻とTZだけ変えて（UTC/JST/US、
//    JST 00:00〜23:59）実行し、**出力が1バイトでも変わったら ERROR**（＝振る舞いで落ちる）

/** 壁時計。**このファイルの外から呼ばない**（上のコメント参照）。 */
function wallClockMs(): number {
  return Date.now();
}

/**
 * 「瞬間」を表す値（scrapedAt / marketCheckedAt / ログの時刻）。
 *
 * 暦日（発売日・締切日）には**使わない**。暦日が要るときは todayJst()。
 * 分けている理由: 瞬間をそのまま日付として読むと、読む側のTZで日が変わる。
 */
export function nowInstant(): Date {
  return new Date(wallClockMs());
}

/**
 * 任意の瞬間（epoch ms）→ **日本時間での暦日**（UTC 0時固定）。
 *
 * 実測（2026-08-16 06:39 JST ＝ 21:39Z）: ここを通さず `new Date()` の UTC暦日を
 * 使っていたため、収集元の「締切 本日 22:00」が前日に解決され、
 * **今日まだ応募できる抽選を「昨日締切」と表示**していた。
 */
export function jstCalDate(nowMs: number): Date {
  const j = new Date(nowMs + 9 * 60 * 60 * 1000);
  return new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate()));
}

/**
 * 日本時間の「今月」から monthOffset ヶ月ずらした年月。
 * 収集元の月別ページURL（`?sale_month=8&sale_year=2026` 等）を組み立てる用。
 *
 * なぜ要るか: 月URLを `new Date().getMonth()` で作っていたソースが3つあった
 * （ichibanKuji / snkrdunk / torecasoku）。ローカル時刻なので実行環境のTZ次第で、
 * UTCの箱で回すと**毎月1日の JST 00:00〜08:59 に前月のページを取りに行く**＝
 * その月の新商品を丸ごと取りこぼす。エラーも件数の急減も出ない静かな取りこぼし。
 */
export function jstYearMonth(monthOffset = 0): { year: number; month: number } {
  const t = todayJst();
  const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + monthOffset, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

/** 年月日から「暦日」を作る（UTC 0時固定） */
export function calendarDate(year: number, month1: number, day: number): Date {
  return new Date(Date.UTC(year, month1 - 1, day));
}

/**
 * 日本時間での「今日」を暦日（UTC 0時）で返す。過去判定の基準に使う。
 *
 * `HATSUKORE_SIMULATE_TODAY=YYYY-MM-DD` を渡すと、その日を「今日」として扱う。
 * **`npm run audit:tomorrow`（明日を先取りする自己テスト）専用**で、サイトの表示・掲載基準・
 * 監査が「同じ今日」を見ている性質をそのまま利用するために、ここ1か所だけで受ける。
 *
 * なぜ要るか（2026-08-11 実測）: 前日に足した `page_vanished` が、翌朝いちばんに在籍1件の
 * ジャンルが過去日で消えただけで ERROR を出し、**更新の関門を誤報で止めた**。データは1バイトも
 * 変わっていないのに暦が進むだけで鳴る検査は、こうして翌朝まで分からない。先に日付だけ進めて
 * 回せば、その日のうちに分かる。
 *
 * 本番では絶対に効かせない: `NODE_ENV=production`（Vercel のビルド・実行）では無視する。
 * サイトの「今日」が環境変数で動くと、日付の間違いを環境変数のせいで作り込めてしまうため。
 */
export function todayJst(): Date {
  const sim = process.env.HATSUKORE_SIMULATE_TODAY;
  if (sim && process.env.NODE_ENV !== "production") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(sim.trim());
    if (!m) throw new Error(`HATSUKORE_SIMULATE_TODAY は YYYY-MM-DD で指定する: ${sim}`);
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  }
  return jstCalDate(wallClockMs());
}

/** "7/25(土)"。ただし今年(日本時間基準)以外は年を付けて "2027/7/28(水)"。
 *  年を省くと、来年の日付が今年の間に紛れて「順番がおかしい」ように見えるため。 */
export function formatShort(d: Date | string): string {
  const x = new Date(d);
  const y = x.getUTCFullYear();
  const md = `${x.getUTCMonth() + 1}/${x.getUTCDate()}(${DAYS[x.getUTCDay()]})`;
  return y === todayJst().getUTCFullYear() ? md : `${y}/${md}`;
}

/** 英語版の短い日付 "Sep 5 (Fri)"。今年以外は "Sep 5, 2027 (Fri)"（formatShort と同じ理由で年を付ける）。
 *  **月は必ず綴る**: "9/5" は 米=Sep 5 / 英=May 9 と読みが割れる（[[Projects/sedori_radar_en]] 注意点§2）。
 *  書式は画面監査（renderedDateProblems / parseDisplayedDate）が読める形に固定。 */
export function formatShortEn(d: Date | string): string {
  const x = new Date(d);
  const y = x.getUTCFullYear();
  const m = MONTHS_EN[x.getUTCMonth()];
  const dow = DAYS_EN[x.getUTCDay()];
  return y === todayJst().getUTCFullYear()
    ? `${m} ${x.getUTCDate()} (${dow})`
    : `${m} ${x.getUTCDate()}, ${y} (${dow})`;
}

/** 英語版の月精度ラベル "Sep 2026"（合成した日を出さない＝eventDateLabel と同じ規則）。 */
export function formatMonthEn(d: Date | string): string {
  const x = new Date(d);
  return `${MONTHS_EN[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
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

/**
 * **画面に出ている文字列そのもの**を読んで、日付の矛盾を見つける（描画監査 `audit:page` 用）。
 *
 * なぜデータ側の検査と別に要るか（2026-08-16 ミス23）: 同じ商品ページの上部が
 * 「抽選日 2026年8月16日(日) 🔥本日」、下の店舗行が「〜明日 22:00」と**1画面の中で
 * 食い違って**いた。人間が見れば一瞬で気付くのに、audit も audit:page も selftest も
 * 全部 ERROR 0 だった（データは「壊れて」おらず、保存した相対表記が古くなっただけだから）。
 *
 * ここでは、読む人が実際に目にする文字列だけを見る:
 *  ① 曜日が暦と合っているか（「8月16日(月)」＝実際は日曜、のような単純な嘘）
 *  ② 「本日 / 明日 / あとN日」が、その隣に書いてある暦日と合っているか
 * どちらも**今日を使って**判定するので、更新しないまま日が経つと鳴る＝
 * 「更新しないと嘘になる表示」をそのまま検出できる。
 */
export function renderedDateProblems(text: string, today: Date): string[] {
  const out: string[] = [];
  const t = text.replace(/\s+/g, " ");
  const nearestYear = (m: number, d: number): Date => {
    const base = today.getUTCFullYear();
    let best = new Date(Date.UTC(base, m - 1, d));
    for (const y of [base - 1, base + 1]) {
      const cand = new Date(Date.UTC(y, m - 1, d));
      if (Math.abs(cand.getTime() - today.getTime()) < Math.abs(best.getTime() - today.getTime())) best = cand;
    }
    return best;
  };

  // ① 曜日の食い違い（年つき・年なしの両方の書式）
  for (const m of t.matchAll(/(?<!\d)(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日\(([日月火水木金土])\)/g)) {
    const mo = Number(m[2]);
    const day = Number(m[3]);
    if (mo < 1 || mo > 12 || day < 1 || day > 31) continue;
    const d = m[1] ? new Date(Date.UTC(Number(m[1]), mo - 1, day)) : nearestYear(mo, day);
    if (d.getUTCDate() !== day) continue; // 2月30日のような存在しない日は別の検査の担当
    if (DAYS[d.getUTCDay()] !== m[4])
      out.push(`曜日が暦と違う: 「${m[0]}」（${d.toISOString().slice(0, 10)} は${DAYS[d.getUTCDay()]}曜）`);
  }
  for (const m of t.matchAll(/(?<!\d)(\d{1,2})\/(\d{1,2})\(([日月火水木金土])\)/g)) {
    const mo = Number(m[1]);
    const day = Number(m[2]);
    if (mo < 1 || mo > 12 || day < 1 || day > 31) continue;
    const d = nearestYear(mo, day);
    if (d.getUTCDate() !== day) continue;
    if (DAYS[d.getUTCDay()] !== m[3])
      out.push(`曜日が暦と違う: 「${m[0]}」（${d.toISOString().slice(0, 10)} は${DAYS[d.getUTCDay()]}曜）`);
  }

  // ①-EN 英語版（/en）の曜日（"Sep 5 (Fri)" / "Sep 5, 2027 (Fri)"）。JPと同じ「暦との突合」。
  for (const m of t.matchAll(
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s(\d{1,2})(?:,\s?(\d{4}))?\s?\((Sun|Mon|Tue|Wed|Thu|Fri|Sat)\)/g
  )) {
    const mo = MONTHS_EN.indexOf(m[1]) + 1;
    const day = Number(m[2]);
    if (day < 1 || day > 31) continue;
    const d = m[3] ? new Date(Date.UTC(Number(m[3]), mo - 1, day)) : nearestYear(mo, day);
    if (d.getUTCDate() !== day) continue;
    if (DAYS_EN[d.getUTCDay()] !== m[4])
      out.push(
        `曜日が暦と違う: 「${m[0]}」（${d.toISOString().slice(0, 10)} は ${DAYS_EN[d.getUTCDay()]}）`
      );
  }

  // ② 暦日のすぐ隣にある相対表記（本日/明日/あとN日）が、その暦日と合っているか。
  //    間に数字を挟まない短い範囲だけを見る（別のカードの文字列を巻き込まないため）。
  return out;
}

/**
 * 画面に出ている**日付ラベル**（"8/16(日)" / "2026年8月16日(日)" / "2027/1/5(火)"）を読む。
 * 年が書いていないものは、基準日にいちばん近い年として解釈する（画面の読み方と同じ）。
 */
export function parseDisplayedDate(label: string, today: Date): Date | null {
  const s = label.replace(/\s+/g, "");
  const nearest = (mo: number, day: number): Date | null => {
    if (mo < 1 || mo > 12 || day < 1 || day > 31) return null;
    const base = today.getUTCFullYear();
    let best = new Date(Date.UTC(base, mo - 1, day));
    for (const y of [base - 1, base + 1]) {
      const cand = new Date(Date.UTC(y, mo - 1, day));
      if (Math.abs(cand.getTime() - today.getTime()) < Math.abs(best.getTime() - today.getTime())) best = cand;
    }
    return best.getUTCDate() === day ? best : null;
  };
  // 英語版のラベル（"Sep 5 (Fri)" / "Sep 5, 2027 (Fri)"。空白は上で落ちている）。
  // (?!\d) が無いと月精度の "Sep 2026" を「Sep 20」と読んでしまう（勝手に日精度を足す型）。
  const enM = s.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(\d{1,2})(?:,(\d{4}))?(?!\d)/i);
  if (enM) {
    const mo = MONTHS_EN.findIndex((x) => x.toLowerCase() === enM[1].toLowerCase()) + 1;
    if (enM[3]) return new Date(Date.UTC(Number(enM[3]), mo - 1, Number(enM[2])));
    return nearest(mo, Number(enM[2]));
  }
  const long = s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (long) return new Date(Date.UTC(Number(long[1]), Number(long[2]) - 1, Number(long[3])));
  const withYear = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (withYear) return new Date(Date.UTC(Number(withYear[1]), Number(withYear[2]) - 1, Number(withYear[3])));
  const md = s.match(/^(\d{1,2})[/月](\d{1,2})日?/);
  if (md) return nearest(Number(md[1]), Number(md[2]));
  return null;
}

/**
 * 同じカード（同じ商品）の中で、**カウントダウンのバッジ**（🔥 本日 / 明日 / あと3日）と
 * **日付ラベル**（8/16(日)）が食い違っていないか。食い違っていれば理由を返す。
 *
 * これがミス23の症状そのもの: 上が「🔥本日」、下が別の日を指していると、人間は一目で
 * 気付くのに機械の検査は全部素通りしていた。**文字列の近さ（テキストの連結）ではなく
 * 同じカードの要素同士**で突き合わせる。
 * 実測でこの判断は必要だった: 本番の描画は「🔥 本日ワンピースカード8/16(日)」のように
 * 別要素の文字が隙間なく繋がるので、テキストの隣接では作品名（「明日ちゃんのセーラー服」）と
 * 区別できず、両方向の誤りが出た。
 */
export function countdownBadgeProblem(badge: string, dateLabel: string, today: Date): string | null {
  const b = badge.replace(/[🔥\s]/g, "");
  const jp = b.match(/^(本日|明日|あと(\d{1,2})日)$/);
  // 英語版バッジ（i18n.countdownLabel が出す "Today" / "Tomorrow" / "In N days"）。
  // 空白は上で落ちるので "In3days" の形で読む。
  const en = jp ? null : b.match(/^(Today|Tomorrow|In(\d{1,2})days?)$/i);
  if (!jp && !en) return null; // カウントダウンのバッジではない
  const want = jp
    ? jp[1] === "本日"
      ? 0
      : jp[1] === "明日"
        ? 1
        : Number(jp[2])
    : /^today$/i.test(en![1])
      ? 0
      : /^tomorrow$/i.test(en![1])
        ? 1
        : Number(en![2]);
  const d = parseDisplayedDate(dateLabel, today);
  if (!d) return null; // 日付が読めない（月精度の「2026年9月」等）＝この検査の対象外
  const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (diff === want) return null;
  return `バッジ「${badge.trim()}」と日付「${dateLabel.trim()}」が食い違う（${d
    .toISOString()
    .slice(0, 10)} は今日から${diff}日）`;
}

/**
 * 日付が確定していないときに、日付欄へ出してよいテキストかどうか。
 *
 * カードは `formatDate(eventDate) ?? eventDateText` を**発売日と同じ赤字**で出すので、
 * eventDateText に発売日でないものが入っていると、そのまま発売日として読まれる。
 * 実測: Xミラー由来の **275件が「投稿日: 2026-08-07」を日付欄に表示**していた。
 * 投稿日はこちらが記事を拾った日で、商品の発売日・開催日とは何の関係もない。
 * 「裏取り済みの事実だけを約束する」原則に照らすと、これは日付の過剰約束にあたる。
 * 発売日でないと分かるものは、日付欄には出さない（何も出さない方が正しい）。
 */
/**
 * 「これから起きる」と読める日付テキストから、その予定日を読む（読めなければ null）。
 *
 * 書式ごとに明示的に分ける。曖昧に読むと逆に誤りを生む（実測でこの関数の元になった検査は
 * 2回間違えた: 「2026年08月下旬」を「0月8日」と読み、「2026年08月05週」を「8月5日」と読んだ）。
 * 日が特定できない表記（下旬・頃）は **null を返す＝判定しない**。曖昧なものを無理に
 * 日付にすると、こちらが勝手に精度を足したことになる。
 */
export function plannedDateFromText(text: string | null): Date | null {
  if (!text) return null;
  if (!/予定|開始|受付|締切|まで/.test(text)) return null; // 未来を約束していない表記は対象外
  const week = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(?:第)?\s*(\d{1,2})\s*週/);
  if (week) {
    // 「M月N週」はその週の初日として扱う（週の中のどの日かは分からないので最も早い日）。
    return new Date(Date.UTC(Number(week[1]), Number(week[2]) - 1, (Number(week[3]) - 1) * 7 + 1));
  }
  const ymd = text.match(/(\d{4})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})\s*日?(?!\s*週)/);
  if (ymd) return new Date(Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])));
  // 「2026年07月下旬」のように日が無い表記は、**その月の末日**として扱う。
  // 日を特定できない曖昧さは「最も遅い日」に倒す＝まだ来ていない可能性を潰さない。
  // これなら「07月下旬」は7/31、「08月下旬」は8/31になり、過ぎた月だけが確実に落ちる。
  const ym = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
  if (ym) {
    const y = Number(ym[1]);
    const m = Number(ym[2]);
    return new Date(Date.UTC(y, m, 0)); // 翌月0日＝その月の末日
  }
  return null;
}

/** 日付未定として表示している予定が、既に過ぎているか（＝陳腐化した予定）。 */
export function isStalePlan(
  eventDate: Date | string | null,
  eventDateText: string | null,
  today: Date
): boolean {
  if (eventDate) return false;
  const planned = plannedDateFromText(eventDateText);
  return planned !== null && planned.getTime() < today.getTime();
}

/**
 * 期限が過ぎたときに、**過去形として何と書けばよいか分かっている**ラベルだけの対応表。
 *
 * 「知っているものだけ書き換える」ことが要点。パターン一致（`/受付中/` 等）で広く拾うと、
 * 知らない種類のものにこちらが勝手な断定を足す（実測: 合成テストで「エントリー受付中」が
 * 「予約終了」に書き換わった。予約ではないのに予約と言い切っている）。
 * 表に無いものは書き換えず、下の invariant に出して人間が決める。
 *
 * ※「予約開始」は入れない。予約開始日が過ぎている＝**受付が始まった**という意味で、
 *   期限切れではない（実測7件を誤って巻き込んだ）。
 * ※ 月までしか分かっていない表記（「2026年8月発送予定」）は plannedDateFromText が
 *   **その月の末日**に倒すので、月内はまだ過ぎたと判定しない。
 */
const PAST_TENSE_LABELS: Record<string, string> = {
  予約受付中: "予約終了",
  予約: "予約終了",
  登場予定: "登場済み",
};

/**
 * バッジに出す種別ラベル。**期限が過ぎたものを「予定」「受付中」と書かない。**
 *
 * 実測2種:
 *  ・「登場予定 / 6月3日」45件 … 2ヶ月前の日付で「予定」。プライズは既にゲームセンターに
 *    登場済みで、商品としては有効（むしろ今買える）。予定という言葉だけが事実と合っていない。
 *  ・「予約受付中 / 2023年4月発送予定」171件 … 収集元の記事が当時の表記で凍結しており、
 *    こちらも一度取得した行は詳細を再取得しない設計なので**通常の更新では永久に直らない**。
 *    プレミアムバンダイの受注は発送月より前に締め切られるので、発送月が過ぎていれば
 *    受付は終わっている。
 *
 * どちらも**掲載可否ではなく表記の問題**。落とすと、もう買えないからこそ価値がある
 * プレ値情報まで消える（実測: /premium が 63→36 件に激減した）。ここでラベルだけを直す。
 */
/**
 * 予定日が過ぎたか。**バッジ（displayEventType）と日付の見出し（eventDateHeading）で
 * 同じ判定を使う**ために切り出した。ここが二重定義になると、同じページで
 * 「登場済み」バッジの下に「登場予定」という見出しが並ぶ（実測 2026-08-18: 222件）。
 */
export function isEventPast(
  eventDate: Date | string | null,
  eventDateText: string | null,
  today: Date
): boolean {
  const planned = plannedDateFromText(eventDateText) ?? (eventDate ? new Date(eventDate) : null);
  return planned !== null && planned.getTime() < today.getTime();
}

export function displayEventType(
  eventType: string,
  eventDate: Date | string | null,
  eventDateText: string | null,
  today: Date
): string {
  if (!isEventPast(eventDate, eventDateText, today)) return eventType;
  return PAST_TENSE_LABELS[eventType] ?? eventType;
}

/**
 * 期限が過ぎた行の「これは過去の情報です」表示。**言い切れることだけを書く。**
 *
 * 「終わったものを消さずに残す」ための表示側の実装（サウナイキタイの【閉店】表示に倣う。
 * あちらは閉店した施設を消さず、冠と告知ブロックと情報源リンクを付けて残している）。
 * ハツコレは既に**過去行のページを 200 で残しており**（getItemById は日付で絞らない）、
 * sitemap も直近60日ぶんを申告している。欠けているのは**残っているページが過去だと言わない**こと。
 *
 * 実測 2026-08-22（本番 /items/14159・開催日 8/6 の16日後）: バッジ「開催」／「開催日 2026年8月6日(木)」／
 * 赤い「公式で販売内容を見る →」／「※ 予約・購入は各リンク先で最新の在庫・価格・抽選条件を
 * ご確認ください。」。画面のどこにも過去のものだと書いていない＝**現在進行形の嘘**。
 * この状態のページが本番に 1,643件（うち 1,207件が sitemap 申告中）ある。
 *
 * **「日付が過ぎた」＝「終わった」ではない。** 種別ごとに言えることが違うので3つに分ける
 * （本番の eventType 語彙10種を数えた上での対応表。表に無いものは断定しない側に倒す）:
 *
 *  ・ended   … 過ぎた日付が**締切**なので、受付が終わったと言い切れる。抽選(69件)/予約(191件)。
 *              PAST_TENSE_LABELS が既にバッジで「予約終了」と書いている行と同じ判断に揃える。
 *  ・passed  … 過ぎても買えなくなったとは言えない（むしろ今買える）。発売(387)/登場予定(428)/
 *              再販(36)/予約開始(27)/販売開始(16)。「終了しました」と書いてはいけない側。
 *  ・unknown … 終わったか分からない。開催(464)/情報(25)/未知の語彙。**eventDate は開始日で、
 *              終了日を持つ列が無い**ので、まだやっているかもしれない。分からないと書く。
 *
 * 終了日を eventDateText の範囲表記から読み取って ended に格上げする案は採らない:
 * 自由文の範囲末尾を当てにいくと、外した時に「終了しました」という**取り返しのつかない断定**を
 * 出すことになる（既定値に語らせない／知っているものだけ書き換える）。
 *
 * この関数は時計を読まない（today を受け取る）。
 */
export type PastNoticeKind = "ended" | "passed" | "unknown";
export type PastNotice = { kind: PastNoticeKind; headline: string; detail: string };

/** 過ぎた日付が締切だと言い切れる種別 → 見出し。 */
const ENDED_NOTICE: Record<string, string> = {
  抽選: "応募の受付は終了しました",
  予約: "予約の受付は終了しました",
  予約受付中: "予約の受付は終了しました",
};

/** 日付は過ぎたが「もう買えない」とは言えない種別 → 見出し。 */
const PASSED_NOTICE: Record<string, string> = {
  発売: "発売日は過ぎています",
  再販: "再販日は過ぎています",
  販売開始: "販売開始日は過ぎています",
  予約開始: "予約の開始日は過ぎています",
  登場予定: "登場日は過ぎています",
};

export function pastNotice(
  item: { eventType: string; eventDate: Date | string | null; eventDateText: string | null },
  today: Date
): PastNotice | null {
  if (!isEventPast(item.eventDate, item.eventDateText, today)) return null;
  const ended = ENDED_NOTICE[item.eventType];
  if (ended) {
    return {
      kind: "ended",
      headline: ended,
      detail: "掲載している締切は過ぎています。再受付・再販があるかどうかは、このページでは確認できていません。",
    };
  }
  const passed = PASSED_NOTICE[item.eventType];
  if (passed) {
    return {
      kind: "passed",
      headline: passed,
      detail: "今も購入できるかどうかは確認できていません。リンク先の公式ページでご確認ください。",
    };
  }
  // 「開催」と未知の語彙。開始日しか持っていないので、終わったとは書かない。
  return {
    kind: "unknown",
    headline: "掲載している日付は過ぎています",
    detail: "終了しているかどうかは確認できていません。最新の状況はリンク先の公式ページでご確認ください。",
  };
}

export function isStalePromise(
  eventType: string | null,
  eventDate: Date | string | null,
  eventDateText: string | null,
  today: Date
): boolean {
  if (!eventType) return false;
  // **表示層で判定する。** データ側の eventType で鳴らすと、表示層で直しているものまで
  // 鳴り続けて「決して0にならない検査」になる（8/7に踏んだ型）。画面に出る文字列を見れば、
  // 表示の直し忘れだけが残る。
  const shown = displayEventType(eventType, eventDate, eventDateText, today);
  if (!/受付中|予定/.test(shown)) return false;
  const planned = plannedDateFromText(eventDateText) ?? (eventDate ? new Date(eventDate) : null);
  return planned !== null && planned.getTime() < today.getTime();
}

/**
 * 元の情報が「月までしか分かっていない」か（＝日を特定できていない）。
 *
 * 実測: プレミアムバンダイの79件は元テキストが「2026年9月発送予定」なのに、
 * eventDate に月初(9/1)が入っていたため、カードには **「9/1(火)」という特定日** が
 * 発売日と同じ赤字で出ていた（表示日の分布が全件1日＝合成の動かぬ証拠）。
 * 実際には「9月中に発送」であって、9月1日に何かが起きるわけではない。
 * ソート・月ページのために月初を保持するのは妥当だが、**表示まで特定日にしてはいけない**。
 */
export function isMonthPrecision(eventDateText: string | null): boolean {
  if (!eventDateText) return false;
  if (/\d{1,2}\s*[日週]/.test(eventDateText)) return false; // 日・週まで分かっている
  return /\d{1,2}\s*月/.test(eventDateText);
}

/**
 * 「保存してはいけない相対日付」を含む表示文字列か（純関数・監査と selftest が使う）。
 *
 * 相対日付は**読んだ瞬間の today から作る**もので、DBに保存した時点で「巡回した日」に
 * 固定される＝翌日から嘘になる。ハツコレは手動更新なので、ズレは更新するまで増え続ける。
 *
 * 作品名・人名を巻き込まないよう、**相対日付として使われている形**だけを拾う
 * （実測: 全DB3396件で「天上院明日香」「中村明日美子」は素通り、相対表記だけが鳴った）。
 */
export function hasFrozenRelativeDate(text: string | null | undefined): boolean {
  if (!text) return false;
  return /[〜～]\s*(?:本日|明日|明後日)|(?:本日|明日|明後日|今日|昨日)\s*\d{1,2}\s*[:：時]|(?:本日|明日|明後日)\s*(?:まで|より|から|締切|発売|開始|受付|抽選|入荷|販売)/.test(
    text
  );
}

/**
 * 商品名（＝画面に出ているタイトル）が「◯月発売」と言っているのに、日付欄が「日付未定」に
 * なっている行から、**月精度の予定テキスト**を作る。読めなければ null。
 *
 * なぜ要るか（2026-08-16 実測・観点C 通読）: 掲載1464件のうち194件が日付未定で、うち49件は
 * カードの商品名そのものが「ヒロアカ … 12月発売」「ちいかわ … 8月上旬登場!」と月を書いていた。
 * **同じカードの中で、商品名が「12月発売」と言い、その真横のラベルが「日付未定」**という状態で、
 * 「いつ買えるか」を約束するサイトとしては人間が一目で気付く矛盾だった。情報は既に持っていて、
 * 読み取っていないだけ。
 *
 * 精度を足さない（ミス15）ための約束:
 *  ・**日は作らない。** 返すのは「2026年12月発売予定」という月精度のテキストだけで、
 *    eventDate（特定日）は埋めない。isMonthPrecision / plannedDateFromText が月末扱いする。
 *  ・**年を推測しない。** 基準日の月より前の月（＝今年なら過去）は、来年のことなのか
 *    去年の記事なのか決められないので **読まない**（過ぎた日付が未来に化けたミスの再発防止）。
 *  ・**日が書いてあるタイトルには手を出さない。** 「8月28日より開催」は日精度の情報なので、
 *    ここで月に丸めると精度を落とす。別の経路（extractDateAndEventFromText）の担当。
 */
const MONTH_PLAN_VERBS = "発売|再販|登場|発送|開催|販売|公開|配信|開始";
export function monthPrecisionFromTitle(title: string, today: Date): string | null {
  if (!title) return null;
  if (/\d{1,2}\s*月\s*\d{1,2}\s*日/.test(title)) return null; // 日まで書いてある＝ここの担当外
  const m = title.match(
    new RegExp(`(\\d{1,2})\\s*月\\s*(上旬|中旬|下旬)?[^\\d月]{0,4}?(${MONTH_PLAN_VERBS})`)
  );
  if (!m) return null;
  const month = Number(m[1]);
  if (month < 1 || month > 12) return null;
  const curMonth = today.getUTCMonth() + 1;
  if (month < curMonth) return null; // 年を決められない＝読まない
  return `${today.getUTCFullYear()}年${month}月${m[2] ?? ""}${m[3]}予定`;
}

/**
 * カード・詳細に出す日付ラベル。分かっている精度でしか書かない。
 *  ・日まで分かっている → "8/8(土)" / "2026年8月8日(土)"
 *  ・月までしか分からない → "2026年9月"（合成した日を出さない）
 *  ・日付が無い → 発売日でないテキスト（投稿日等）は出さない
 */
export function eventDateLabel(
  eventDate: Date | string | null,
  eventDateText: string | null,
  style: "short" | "long" = "short"
): string | null {
  if (eventDate && isMonthPrecision(eventDateText)) {
    const x = new Date(eventDate);
    return `${x.getUTCFullYear()}年${x.getUTCMonth() + 1}月`;
  }
  if (eventDate) return style === "long" ? formatLong(eventDate) : formatShort(eventDate);
  return displayEventDateText(eventDateText);
}

/**
 * eventDateLabel の英語版。**精度の規則は同一**（月精度は "Sep 2026"・日精度は "9/5 (Fri)"）。
 * 日付が無い行の eventDateText は収集元の日本語のまま返す＝訳さない
 * （原文の言い換えは精度・意味を足すリスクがあるので、表示側が lang="ja" を付けて出す）。
 */
export function eventDateLabelEn(
  eventDate: Date | string | null,
  eventDateText: string | null
): string | null {
  if (eventDate && isMonthPrecision(eventDateText)) return formatMonthEn(eventDate);
  if (eventDate) return formatShortEn(eventDate);
  return displayEventDateText(eventDateText);
}

export function displayEventDateText(eventDateText: string | null): string | null {
  if (!eventDateText) return null;
  // 「投稿日」「掲載日」＝こちらが記事を拾った日。商品の日付ではないので日付欄に出さない。
  if (/投稿日|掲載日|更新日/.test(eventDateText)) return null;
  return eventDateText;
}

/**
 * 日付ラベルとは**別に**出す「受付期間・締切・時刻」の補足。
 *
 * 観点B実使用（2026-08-15）: 一番くじONLINE再販の受付は「8/17 11:00〜8/20 23:59」の4日間、
 * SNKRS抽選は「応募締切 8/15 9:10」——**今から間に合うかを決める情報**が eventDateText に
 * 入っているのに、eventDate があると日付ラベルに負けて一切表示されていなかった。
 * 収集元の文言をそのまま出す（精度を足さない・言い換えない）。
 *
 * 出す条件: 時刻・期間・締切のいずれかを含む＝暦日だけの言い換えには出さない
 * （「2026年8月17日」を二度書くのはノイズ）。「発送予定」は eventDateHeading が
 * 見出しごと切り替えるのでここでは扱わない。
 */
export function eventPeriodText(
  eventDate: Date | string | null,
  eventDateText: string | null
): string | null {
  if (!eventDateText) return null;
  if (!eventDate) return null; // 日付が無い行は eventDateLabel がテキストをそのまま出す
  if (/投稿日|掲載日|更新日|発送予定/.test(eventDateText)) return null;
  const hasTime = /\d{1,2}[:：]\d{2}/.test(eventDateText);
  const hasRange = /[〜~～].*\d|\d.*[〜~～]/.test(eventDateText) && /月|\//.test(eventDateText);
  const hasDeadline = /締切|期間|受付|応募|先着/.test(eventDateText);
  if (!hasTime && !hasRange && !hasDeadline) return null;
  return eventDateText.trim();
}
