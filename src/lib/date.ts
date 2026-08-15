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
export function displayEventType(
  eventType: string,
  eventDate: Date | string | null,
  eventDateText: string | null,
  today: Date
): string {
  const past = (() => {
    const planned = plannedDateFromText(eventDateText) ?? (eventDate ? new Date(eventDate) : null);
    return planned !== null && planned.getTime() < today.getTime();
  })();
  if (!past) return eventType;
  return PAST_TENSE_LABELS[eventType] ?? eventType;
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
