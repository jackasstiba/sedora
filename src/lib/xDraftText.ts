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
  /**
   * dateLabel が null のときに行頭へ出す語。**呼び出し側が実データから決める。**
   *
   * 🚨 ここを機械が「受付中」で埋めてはいけない（2026-08-19 実測）: 日付が無い行には
   * `eventDateText="受付終了（直近 7/1）"` ＝**もう応募できない行**が混ざっていて、
   * 下書きは「受付中 ニッカウイスキー竹鶴」と書いていた。日付が無い＝受付中、ではない。
   * 何と書けるか分からない行は**載せない**（この値が無い行は buildPost が落とす）。
   */
  noDateLabel?: string;
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
  if (showDate) parts.push(`${r.dateLabel ?? r.noDateLabel} `);
  if (showType) parts.push(`${r.type} `);
  parts.push(r.name);
  return parts.join("");
}

export function buildPost(opts: {
  rows: DraftRow[];
  /** 種別を含まない見出しの語（例: "本日の予定"）。全行の種別が一致したときだけ種別に置き換わる */
  headBase: string;
  /** 見出しの【】の後ろに足す語（例: "応募受付中"）。**言い切れることだけ**を書く */
  headNote?: string;
  tail: string;
  weigh: (s: string) => number;
  budget: number;
}): { text: string; used: DraftRow[] } {
  const { headBase, headNote, tail, weigh, budget } = opts;
  // 日付も、その代わりに書く語も無い行は載せない（勝手に「受付中」と補わないため）
  const rows = opts.rows.filter((r) => r.dateLabel !== null || r.noDateLabel);

  // 1st pass: **一番冗長な形（日付+種別つき）**で、予算に入る行を確定させる。
  // ここで確定した集合は以降変えない。簡略化すると文字数は減るだけなので必ず収まる。
  const probeHead = `【${headBase}】${headNote ?? ""}`;
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
  const head = `【${type ?? headBase}】${[headNote, date].filter(Boolean).join(" ")}`.trim();
  const body = used.map((r) => line(r, date === null, type === null));
  return { text: [head, "", ...body, "", tail].join("\n"), used };
}

/** 立ち位置に反する語（相場・利益を煽る語）。投稿前と表示層スキャンで機械で弾く。
 *  英語版（/en）を作ったので英語の同義語も見張る（立ち位置は言語に依らず同じ）。 */
export const FORBIDDEN_WORDS = ["儲か", "プレ値", "転売", "せどり", "利益", "高騰", "相場"];
/** 英語の禁止語。単語境界で見る（"profitable" も "reseller" も語幹で拾いたいので部分一致のまま、
 *  ただし大文字小文字は吸収する）。 */
export const FORBIDDEN_WORDS_EN = ["resell", "resale", "scalp", "profit", "flip for"];

export function findForbidden(text: string): string[] {
  const lower = text.toLowerCase();
  return [
    ...FORBIDDEN_WORDS.filter((w) => text.includes(w)),
    ...FORBIDDEN_WORDS_EN.filter((w) => lower.includes(w)),
  ];
}

// ── 本文に書いた「数」が今のデータと合っているか ────────────────
//
// なぜ要るか（2026-08-19 実測）: 手で書いた告知文が `2,139件` `26の情報源` のまま残り、
// 実データは `1,873件` `24` になっていた（巡回停止で日付切れが落ちた分）。
// 数は**書いた瞬間から腐る**うえ、本人にもレビュアーにも誤りが見えない。
// よって下書きの数は facts から組み立て、送る直前に**もう一度**突き合わせる。

/** 本文中の「N件」「Nの情報源」など、データを名指しした数の主張 */
export type NumberClaim = { raw: string; value: number; unit: string };

/** 単位語 → その単位で名乗ってよい実データの名前 */
const CLAIM_UNITS: Record<string, string> = {
  件: "件",
  の情報源: "収集元",
  情報源: "収集元",
  サイト: "収集元",
  ソース: "収集元",
  ジャンル: "ジャンル",
};

const CLAIM_PATTERN = new RegExp(
  "([0-9][0-9,]*)\\s*(" + Object.keys(CLAIM_UNITS).join("|") + ")",
  "g",
);

export function findNumberClaims(text: string): NumberClaim[] {
  const out: NumberClaim[] = [];
  for (const m of text.matchAll(CLAIM_PATTERN)) {
    const value = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    out.push({ raw: m[0], value, unit: CLAIM_UNITS[m[2]] });
  }
  return out;
}

/** 実データ側の「名乗ってよい数」。単位ごとに候補を並べる */
export type FactCounts = { 件: number[]; 収集元: number[]; ジャンル: number[] };

/**
 * 本文の数が、今のデータのどれとも一致しなければ指摘して返す。
 * **どの数のつもりかは解釈しない**（解釈は当たらない）。単位ごとの候補集合に
 * 入っているかだけを見る。入っていない＝腐っている、として送らせない。
 */
export function findStaleNumbers(text: string, facts: FactCounts): string[] {
  const out: string[] = [];
  for (const c of findNumberClaims(text)) {
    const allowed = facts[c.unit as keyof FactCounts] ?? [];
    if (allowed.includes(c.value)) continue;
    out.push(`「${c.raw}」は今のデータに無い数（${c.unit}の実数: ${allowed.join(" / ") || "なし"}）`);
  }
  return out;
}

// ── 初回告知（固定ポスト用）────────────────────────────
//
// 文面そのものは手で決めてよいが、**数だけは facts から入れる**（手で書くと必ず腐る）。
// 収集元のサイト名は出さない／「自動で最新」とは言わない（更新は手動のみ）。

export type LaunchFacts = {
  /** 掲載件数 */
  items: number;
  /** 表示中の行が実際に使っている収集元の数 */
  sources: number;
  /** これから7日のあいだに日付があるもの */
  within7: number;
  /** 掲載URL */
  site: string;
};

export function buildLaunchPosts(f: LaunchFacts): { kind: string; note: string; text: string }[] {
  const n = (v: number) => v.toLocaleString("en-US");
  const site = f.site.replace(/\/+$/, "") + "/";

  const bodyB = [
    "「予約開始に気づかず完売」「抽選の締切を過ぎた」",
    "これを無くしたくて、レア・限定品の",
    "予約・抽選・発売 の予定を1画面にまとめました。",
    "",
    "フィギュア・トレカ・スニーカー・一番くじ・コラボ",
    `${n(f.items)}件を日付順に並べています。`,
    "",
  ];

  return [
    {
      kind: "launch_a",
      note: "初回告知A（機能訴求・本文にリンク）",
      text: [
        "フィギュア・トレカ・スニーカー・一番くじ・コラボグッズの",
        `「予約 / 抽選 / 発売」を${f.sources}の情報源から集めて`,
        "日付順に並べています📡",
        "",
        `・いま掲載 ${n(f.items)}件`,
        "・予約 / 抽選 / 発売 で絞り込み",
        "・ジャンル別/カード別ページあり",
        "",
        `▶ ${site}`,
        "#フィギュア #トレカ #ポケカ #一番くじ",
      ].join("\n"),
    },
    {
      kind: "launch_b",
      note: "初回告知B（課題共感・本文にリンク）",
      text: [...bodyB, site, "", "抜けているジャンルがあれば教えてください"].join("\n"),
    },
    {
      kind: "launch_b_nolink",
      note: "初回告知B（リンクをリプに逃がす版。本文にURLを置かない）",
      text: [...bodyB, "リンクはリプ欄に。", "抜けているジャンルがあれば教えてください"].join("\n"),
    },
    {
      kind: "launch_b_reply",
      note: "上の nolink 版に自分でぶら下げるリプライ",
      text: [
        "こちらです。",
        site,
        "",
        `これから7日のあいだだけでも 予約・抽選・発売 の予定が${n(f.within7)}件あります。`,
        "締切のあるものは日付順に上から並びますので、",
        "「気づいたら終わっていた」を減らせるはずです。",
      ].join("\n"),
    },
  ];
}
