/**
 * 文章の中から「暦日」を読み取る、ただ1つの実装。
 *
 * なぜ要るか（2026-08-19 実測）: 日付の正しさを守る網は、これまで**自分の中の辻褄**しか
 * 見ていなかった。同じ行が `eventDate`（画面に出る日付）と `eventDateText`（収集元の文言）を
 * 両方持っているのに、突き合わせる検査がどこにも無く、figisland の 21件が
 * **最大2週間早い日付**で本番に出ていた（収集元の見出しが `id="20260904"` を 9/4・9/11・9/18 の
 * 3つで使い回していて、こちらは**表示文言ではなく id を信じていた**）。
 *
 * たちが悪いのは、**正解が同じ行の中にあったのに誰にも見えなかった**こと。文言
 * 「2026年09月18日登場予定」は時刻も期間も含まないので画面には出ない（eventPeriodText の条件）。
 * 読者が見るのは「9/4(金)」だけで、しかもそれは `<title>` と meta description にも入る
 * （実測: /items/95479 の title が「…の登場予定｜9/4(金)」）。
 *
 * 日付の書式は多様なので「本文に含まれるか」を substring で見ると当たらない。
 * ここで**暦日として取り出してから**比べる。
 *
 * ⚠️ 取り出しは**多めに拾う**（＝再現率優先）。使う側は「こちらの日付が
 * 一次情報のどこにも無い」ときだけ指摘する片側の網なので、拾いすぎは
 * 見逃しにはなっても誤報にはならない。逆に取りこぼすと誤報になる。
 */

export type FoundDate = {
  /** 年が書かれていなければ null（＝年は判定に使わない） */
  year: number | null;
  month: number;
  day: number;
  /** 実際に本文にあった文字列（指摘に出して人が確かめられるようにする） */
  raw: string;
};

/** 全角数字・全角記号を半角に寄せる（表記ゆれで取りこぼさないため） */
export function normalizeDigits(text: string): string {
  return text
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[／]/g, "/")
    .replace(/[．]/g, ".")
    .replace(/[－ー―‐]/g, "-");
}

type Pattern = { re: RegExp; y: number | null; m: number; d: number };

// 順番が意味を持つ: 年付きを先に食わせ、同じ文字を「年の無い日付」として
// 二度拾わないようにする。二度拾うと "2026年8月19日" が (null,8,19) としても
// 出てしまい、**年だけが違う日付**（2027-08-19）が一致扱いになる。
const PATTERNS: Pattern[] = [
  // 2026年8月19日 / 2026 年 08 月 19 日
  { re: /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g, y: 1, m: 2, d: 3 },
  // 2026/8/19, 2026-08-19, 2026.8.19
  { re: /(\d{4})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})(?![\d./-])/g, y: 1, m: 2, d: 3 },
  // 8月19日
  { re: /(\d{1,2})\s*月\s*(\d{1,2})\s*日/g, y: null, m: 1, d: 2 },
  // 8/19（前後に数字や区切りが続くもの＝1/144 スケールや 2026/8/19 の一部は除く）
  { re: /(?<![\d./-])(\d{1,2})\/(\d{1,2})(?![\d./-])/g, y: null, m: 1, d: 2 },
];

/** 文章に出てくる暦日をすべて取り出す（年が書かれていないものは year=null）。 */
export function extractDates(text: string): FoundDate[] {
  const t = normalizeDigits(text);
  const used: boolean[] = new Array(t.length).fill(false);
  const out: FoundDate[] = [];
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    for (const m of t.matchAll(p.re)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      let overlaps = false;
      for (let i = start; i < end; i++) if (used[i]) overlaps = true;
      if (overlaps) continue;
      const month = Number(m[p.m]);
      const day = Number(m[p.d]);
      if (month < 1 || month > 12 || day < 1 || day > 31) continue;
      for (let i = start; i < end; i++) used[i] = true;
      out.push({
        year: p.y == null ? null : Number(m[p.y]),
        month,
        day,
        raw: m[0].replace(/\s+/g, ""),
      });
    }
  }
  return out;
}

/** その暦日が、取り出した日付のどれかと一致するか（年は書かれているときだけ見る）。 */
export function datesInclude(found: FoundDate[], date: Date): boolean {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  return found.some((f) => f.month === m && f.day === d && (f.year == null || f.year === y));
}

/** 文章にその暦日が書かれているか。 */
export function textHasDate(text: string, date: Date): boolean {
  return datesInclude(extractDates(text), date);
}

/**
 * 同じ行が持つ「日付」と「日付の文言」が食い違っていないか。
 *
 * 文言に暦日が1つも無いとき（「2026年9月上旬」「抽選 受付中」）は判定しない＝null。
 * 精度の話は別の検査（date_fabricated_precision）が見る。
 *
 * @returns 食い違っていれば説明文、問題なければ null
 */
export function dateTextConflict(eventDate: Date, eventDateText: string | null): string | null {
  if (!eventDateText) return null;
  const found = extractDates(eventDateText);
  if (!found.length) return null;
  if (datesInclude(found, eventDate)) return null;
  const iso = eventDate.toISOString().slice(0, 10);
  return `日付 ${iso} が、同じ行の文言「${eventDateText}」の日付（${found.map((f) => f.raw).join("・")}）と食い違う`;
}
