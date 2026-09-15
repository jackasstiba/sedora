// 他ソースの `highlights`（「受付中ストア：…」「各賞ラインナップ：…」等）と、stores の
// form / when / note を**英語の枠に組み直す**純関数（2026-09-15）。
//
// なぜ要るか: /en の一覧で highlights を持つ 817 行のうち **270 行（33%）が日本語のまま**
// 出ていた（コラボ書式だけ src/lib/collabHighlights.ts が訳していた）。しかも中身は
// 「どの店が・抽選か先着か・いつまで」という**締切そのもの**で、海外の読者が最も知りたい
// 行が最も読めない状態だった。詳細ページの店舗行も form（抽選）と when（〜9/15 23:59）が
// 日本語のままで、"Conditions: 会員・アプリ" は「日本の会員/アプリが要る＝海外から
// 応募できない」という、読者が真っ先に知るべき条件が読めなかった。
//
// 規約（collabHighlights と同じ）:
//   - **訳すのは枠・書式語だけ**（見出し・販売形式・締切表記・条件の定型語）。店名・商品名・
//     賞品名は固有名なので原文のまま。
//   - **語彙は閉じた表に限る。** 表に無い語は原文のまま返す（勝手な言い換えをしない＝
//     断定を1段強くしない。[[System/rules_hatsukore]] 翻訳の規約）。
//   - **読み解けない書式は null**（呼び出し側が原文を lang="ja" で出す）。
//   - 書式の組み立て側（scrapers / stores.ts の summarizeStores）を変えたら、ここと
//     audit:selftest の往復テストを一緒に直す。

/** 販売形式（StoreEntry.form）の英語。表に無い語（都道府県名など）は null。 */
const STORE_FORM_EN: Record<string, string> = {
  抽選: "Lottery",
  抽選販売: "Lottery",
  先着販売: "First come, first served",
  先着: "First come, first served",
  招待制販売: "Invite-only",
  招待制: "Invite-only",
  受注販売: "Made to order",
  予約: "Pre-order",
  通販: "Online",
  アプリ: "App",
};

export function storeFormEn(form: string | null | undefined): string | null {
  if (!form) return null;
  return STORE_FORM_EN[form.trim()] ?? null;
}

/**
 * 受付時刻（StoreEntry.when／要約の括弧内）の英語。日付は保存どおりの month/day のまま
 * （節の注記が「Dates are month/day, times JST」と宣言している）。
 *   "〜9/15 23:59" → "until 9/15 23:59" ／ "10/20 18:00〜" → "from 10/20 18:00"
 *   "9/20〜" → "from 9/20" ／ "締切時刻 調査中" → "deadline time unconfirmed"
 */
export function storeWhenEn(when: string | null | undefined): string | null {
  if (!when) return null;
  const t = when.trim();
  if (t === "締切時刻 調査中") return "deadline time unconfirmed";
  let m = t.match(/^[〜~](\d{1,2}\/\d{1,2}(?:\s+\d{1,2}:\d{2})?)$/);
  if (m) return `until ${m[1]}`;
  m = t.match(/^(\d{1,2}\/\d{1,2}(?:\s+\d{1,2}:\d{2})?)[〜~]$/);
  if (m) return `from ${m[1]}`;
  return null;
}

/** 条件（StoreEntry.note）の定型語。「・」区切りの各語を表で引き、無い語は原文のまま。 */
const NOTE_TOKEN_EN: Record<string, string> = {
  会員: "store membership required",
  アプリ: "store app required",
  SNS応募: "entry via social media",
  本人確認: "ID check",
  レシート: "receipt required",
  再販分: "restock",
  再販売抽選: "restock lottery",
  再販抽選: "restock lottery",
  追加抽選販売: "additional lottery",
  定価抽選販売: "lottery at list price",
  会員様限定予約: "members-only pre-order",
  カートン予約: "carton pre-order",
  "シュリンク外し": "shrink wrap removed",
  "シュリンクを外しての販売": "sold with shrink wrap removed",
};

function noteTokenEn(token: string): string {
  const t = token.trim();
  if (!t) return t;
  if (NOTE_TOKEN_EN[t]) return NOTE_TOKEN_EN[t];
  let m = t.match(/^価格\s*([\d,]+)円$/);
  if (m) return `price ¥${m[1]}`;
  m = t.match(/^予約特価\s*([\d,]+)円$/);
  if (m) return `pre-order price ¥${m[1]}`;
  m = t.match(/^([\d,]+)円税込$/);
  if (m) return `¥${m[1]} tax incl.`;
  m = t.match(/^([\d,]+)円$/);
  if (m) return `¥${m[1]}`;
  m = t.match(/^お一人様(\d+)(BOX|カートン|パック|個|点)まで$/);
  if (m) return `up to ${m[1]} ${unitEn(m[2], Number(m[1]))} per person`;
  m = t.match(/^(\d+)(BOX|カートン|パック|個|点)$/);
  if (m) return `${m[1]} ${unitEn(m[2], Number(m[1]))}`;
  return t;
}

function unitEn(unit: string, n: number): string {
  const one =
    unit === "BOX" ? "box" : unit === "カートン" ? "carton" : unit === "パック" ? "pack" : "item";
  return n === 1 ? one : `${one}${one === "box" ? "es" : "s"}`;
}

/**
 * 条件の英語。1語でも表で引けたら英語混じりの1行、1語も引けなければ null（原文のまま出す）。
 * 引けなかった語は原文のまま残る（消さない）。
 */
export function storeNoteEn(note: string | null | undefined): string | null {
  if (!note) return null;
  const tokens = note.split("・").map((s) => s.trim()).filter(Boolean);
  if (!tokens.length) return null;
  const out = tokens.map(noteTokenEn);
  return out.some((o, i) => o !== tokens[i]) ? out.join(" · ") : null;
}

// ── 要約（カードの1行）の書式語 ─────────────────────────────────────────

/** 見出し（「：」の左側）の英語。表に無い見出しは読み解かない。 */
const STORE_HIGHLIGHT_PREFIX_EN: Record<string, string> = {
  受付中ストア: "Accepting now",
  応募先: "Listed at",
  "在庫あり・再販中のストア": "In stock / restocked at",
  "直近の抽選・予約実績": "Recent lotteries / pre-orders",
};

/** 括弧の中身「抽選・〜9/15 23:59・2口」を語ごとに訳す。1語も訳せなければ原文。 */
function parenEn(inner: string): string {
  const parts = inner.split("・").map((s) => s.trim()).filter(Boolean);
  let hit = false;
  const out = parts.map((p) => {
    const form = storeFormEn(p);
    if (form) {
      hit = true;
      return form.toLowerCase();
    }
    const when = storeWhenEn(p);
    if (when) {
      hit = true;
      return when;
    }
    const slots = p.match(/^(\d+)口$/);
    if (slots) {
      hit = true;
      return `${slots[1]} entry pages`;
    }
    if (/^\d{1,2}\/\d{1,2}$/.test(p)) {
      hit = true; // 直近実績の「（9/11）」＝実施日
      return p;
    }
    return p;
  });
  return hit ? out.join(" · ") : inner;
}

/** 「店名（…）」の並び（「、」区切り）を英語の枠へ。括弧の中だけ訳す。 */
function storeListEn(body: string): string {
  return body
    .split("、")
    .map((entry) => {
      let e = entry.trim();
      // nyukaNow の実績: 「店名 終了（9/11）」
      e = e.replace(/\s*終了（(\d{1,2}\/\d{1,2})）/g, " ended ($1)");
      // 末尾の括弧（形式・時刻）だけを訳す。店名の中の括弧（「（ナムコパークス各店）」）は
      // 語が表に無いのでそのまま残る。
      return e.replace(/（([^（）]*)）/g, (m0, inner: string) => {
        const t = parenEn(inner);
        return t === inner ? m0 : ` (${t})`;
      });
    })
    .join(", ");
}

/**
 * 店の要約「受付中ストア：A（抽選・〜9/15 23:59）、B（先着販売） 他51店」の英語1行。
 * 見出しが表に無ければ null。
 */
export function summarizeStoreHighlightsEn(highlights: string): string | null {
  const m = highlights.match(/^([^：]+)：([^]*)$/);
  if (!m) return null;
  const heading = STORE_HIGHLIGHT_PREFIX_EN[m[1].trim()];
  if (!heading) return null;
  let body = m[2].trim();
  let tail = "";
  const rest = body.match(/\s*他(\d+)店$/);
  if (rest) {
    tail = ` +${rest[1]} more stores`;
    body = body.slice(0, rest.index);
  }
  // 直近実績は「・」区切り（店名に「・」は出ない書式）。
  const list = m[1].trim() === "直近の抽選・予約実績" ? body.split("・").join("、") : body;
  return `${heading}: ${storeListEn(list)}${tail}`;
}

// ── 賞のラインナップ ────────────────────────────────────────────────

/** 賞ラベルの英語。「A賞」→「A」、「ラストワン賞」→「Last One」。表に無いラベルは原文。 */
export function prizeLabelEn(label: string): string {
  const t = label.trim();
  const m = t.match(/^([A-Z])賞$/);
  if (m) return m[1];
  if (t === "ラストワン賞") return "Last One";
  if (t === "ダブルチャンス賞" || t === "ダブルチャンス") return "Double Chance";
  return t;
}

/**
 * 「各賞ラインナップ：A賞 X ／ B賞 Y（全10種）」「賞品ラインナップ：X ／ Y（全3種）」
 * 「各賞ラインナップ：A賞 X・B賞 Y 他7賞（1セット80本）」（kujimap）の英語1行。
 */
export function summarizePrizeHighlightsEn(highlights: string): string | null {
  const m = highlights.match(/^(各賞ラインナップ|賞品ラインナップ)：([^]*)$/);
  if (!m) return null;
  let body = m[2].trim();
  const extras: string[] = [];
  const total = body.match(/（全(\d+)種）\s*$/);
  if (total) {
    extras.push(`${total[1]} ${m[1] === "各賞ラインナップ" ? "tiers" : "prizes"}`);
    body = body.slice(0, total.index).trim();
  }
  const lot = body.match(/（1セット(\d+)本）\s*$/);
  if (lot) {
    extras.push(`${lot[1]} tickets per set`);
    body = body.slice(0, lot.index).trim();
  }
  let more = "";
  const rest = body.match(/\s*他(\d+)賞$/);
  if (rest) {
    more = ` +${rest[1]} more tiers`;
    body = body.slice(0, rest.index).trim();
  }
  // 区切りは「 ／ 」（一次くじ/一番くじ）か「・」（kujimap＝賞ラベルの直前だけで切る）。
  const entries = body.includes("／")
    ? body.split("／")
    : body.split(/・(?=(?:[A-Z]賞|ラストワン賞|ダブルチャンス賞)\s)/);
  const items = entries
    .map((e) => e.trim())
    .filter(Boolean)
    .map((e) => {
      const lm = e.match(/^([A-Z]賞|ラストワン賞|ダブルチャンス賞)\s+(.+)$/);
      return lm ? `${prizeLabelEn(lm[1])}: ${lm[2].trim()}` : e;
    });
  if (!items.length) return null;
  const heading = m[1] === "各賞ラインナップ" ? "Prize lineup" : "Prizes";
  return `${heading}${extras.length ? ` (${extras.join(" · ")})` : ""}: ${items.join(" · ")}${more}`;
}

// ── その他の1行書式 ──────────────────────────────────────────────────

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** sofvi「受注受付 〜9/18」「抽選受付 〜9/17」、「2027年3月発送予定」、コラボの「公式: 価格帯 …」。 */
export function summarizeSimpleHighlightsEn(highlights: string): string | null {
  const t = highlights.trim();
  let m = t.match(/^受注受付\s*[〜~](\d{1,2}\/\d{1,2})$/);
  if (m) return `Orders accepted until ${m[1]}`;
  m = t.match(/^抽選受付\s*[〜~](\d{1,2}\/\d{1,2})$/);
  if (m) return `Entries accepted until ${m[1]}`;
  m = t.match(/^(\d{4})年(\d{1,2})月発送予定$/);
  if (m) {
    const mo = Number(m[2]);
    return mo >= 1 && mo <= 12 ? `Ships ${MONTHS_EN[mo - 1]} ${m[1]} (planned)` : null;
  }
  m = t.match(/^公式:\s*価格帯\s*(¥[\d,]+)[〜~](¥[\d,]+)・約(\d+)点$/);
  if (m) return `Official price range ${m[1]}–${m[2]} · about ${m[3]} items`;
  return null;
}

/**
 * 他ソース書式の highlights を英語1行にする入口。コラボ書式は collabHighlights 側が先に
 * 読むので、ここには来ない前提（来ても null を返す）。
 */
export function summarizeOtherHighlightsEn(highlights: string | null | undefined): string | null {
  if (!highlights) return null;
  return (
    summarizeStoreHighlightsEn(highlights) ??
    summarizePrizeHighlightsEn(highlights) ??
    summarizeSimpleHighlightsEn(highlights)
  );
}

/**
 * 詳細ページの枠の見出し（英語）。highlights の見出し語（「：」の左側）から決める。
 * 見出し語が無い（コラボ書式）行や表に無い行は null＝呼び出し側が従来の見出しを使う。
 *
 * 2026-09-15 実測: nyukaNow の「直近の抽選・予約実績：ゲオ（アプリ） 終了（9/11）…」が
 * hasLottery=true というだけで **「🎯 Featured prizes」の枠**に入り、続けて「Includes prizes
 * decided by lottery…」と書いていた（JA も「🎯 注目賞品」）。中身は賞品ではなく実施履歴。
 * 見出しは hasLottery でなく**書式の見出し語**から決める。
 */
export function highlightHeadingEn(highlights: string | null | undefined): string | null {
  if (!highlights) return null;
  const m = highlights.match(/^([^：]+)：/);
  if (!m) return null;
  const key = m[1].trim();
  if (STORE_HIGHLIGHT_PREFIX_EN[key]) return STORE_HIGHLIGHT_PREFIX_EN[key];
  if (key === "各賞ラインナップ") return "Prize lineup";
  if (key === "賞品ラインナップ") return "Prizes";
  return null;
}

/** 同じ規則の日本語版（見出し語をそのまま枠の見出しにする）。 */
export function highlightHeadingJa(highlights: string | null | undefined): string | null {
  if (!highlights) return null;
  const m = highlights.match(/^([^：]+)：/);
  return m ? m[1].trim() : null;
}
