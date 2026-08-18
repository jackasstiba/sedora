// X投稿の本文を組み立てる純粋関数。**断定語を文字列で書かない**ための層。
//
// なぜ分けてあるか（2026-08-18 本人「これは間違ってはいけない。俺は間違っても気づけない」）:
// 投稿文の「抽選」「発売」といった語は、収集元のデータを知らない人がレビューしても
// 誤りを検出できない（実測: 「本日の発売予定」と書こうとした5件のうち eventType=発売 は1件だけ）。
// よって**人の注意ではなく構造で守る**: 種別は行の実データから受け取り、
// 見出しに出すのは**載る全行の種別が一致したときだけ**にする。
// ここを純粋関数にしてあるのは `npm run audit:selftest` で振る舞いを固定するため。

export type DraftRow = {
  /** 表示名（切らない） */
  name: string;
  /** サイトと同じ displayEventType を通した種別。呼び出し側で解決して渡す */
  type: string;
  /** "8/18(火)" 等。日付なしは null */
  dateLabel: string | null;
};

/** 全行で値が一致していればその値、そうでなければ null */
function shared<T>(values: T[]): T | null {
  if (values.length === 0) return null;
  if (values.some((v) => v === null || v === undefined)) return null;
  return values.every((v) => v === values[0]) ? values[0] : null;
}

export function sharedType(rows: DraftRow[]): string | null {
  return shared(rows.map((r) => r.type));
}

export function sharedDate(rows: DraftRow[]): string | null {
  return shared(rows.map((r) => r.dateLabel));
}

function line(r: DraftRow, showDate: boolean, showType: boolean): string {
  const parts = ["・"];
  if (showDate) parts.push(`${r.dateLabel ?? "受付中"} `);
  if (showType) parts.push(`${r.type} `);
  parts.push(r.name);
  return parts.join("");
}

export function buildPost(opts: {
  rows: DraftRow[];
  /** 種別を含まない見出しの語（例: "本日の予定"）。全行の種別が一致したときだけ種別に置き換わる */
  headBase: string;
  tail: string;
  weigh: (s: string) => number;
  budget: number;
}): { text: string; used: DraftRow[] } {
  const { rows, headBase, tail, weigh, budget } = opts;

  // 1st pass: **一番冗長な形（日付+種別つき）**で、予算に入る行を確定させる。
  // ここで確定した集合は以降変えない。簡略化すると文字数は減るだけなので必ず収まる。
  const probeHead = `【${headBase}】`;
  const used: DraftRow[] = [];
  for (const r of rows) {
    const body = [...used, r].map((x) => line(x, true, true));
    if (weigh([probeHead, "", ...body, "", tail].join("\n")) > budget) continue;
    used.push(r);
  }
  if (used.length === 0) return { text: [probeHead, "", tail].join("\n"), used };

  // 2nd pass: **載る行だけ**を見て、そろっているものを見出しへ畳む。
  // 候補の配列で判定すると、落ちた行の値まで見てしまう（実測でこの回帰を出した）。
  const type = sharedType(used);
  const date = sharedDate(used);
  const head = `【${type ?? headBase}】${date ?? ""}`.trim();
  const body = used.map((r) => line(r, date === null, type === null));
  return { text: [head, "", ...body, "", tail].join("\n"), used };
}

/** 立ち位置に反する語（相場・利益を煽る語）。投稿前に機械で弾く。 */
export const FORBIDDEN_WORDS = ["儲か", "プレ値", "転売", "せどり", "利益", "高騰", "相場"];

export function findForbidden(text: string): string[] {
  return FORBIDDEN_WORDS.filter((w) => text.includes(w));
}
