/**
 * 「未知の粗の型」を見つけるための観測（`npm run audit` から呼ばれる）。
 *
 * 既存の invariant は **私が過去に見た型** しか見つけられない。今日どの不変条件にも
 * 当てはまらない粗（受付中ストアの表示が区別できない等）が目視で出てきたのがその証拠。
 * 未知の型に手を届かせるには、「異常かどうか」を判定するのをやめて、
 * **前回と違うところ** と **人間が読める生の標本** を毎回差し出す方に賭ける。
 *
 *  (a) ソース別の数値プロファイルを取り、前回との変化が大きい項目を出す
 *      → 収集元の書き方が変わった／整形が効かなくなった、を型を知らずに捕まえる
 *  (b) タイトル整形が「捨てた断片」の頻出語を出す
 *      → 新しい実況表現が増えると、まずここに現れる（表に出る前に気付ける）
 *  (c) 表示行のランダム標本を出す
 *      → 機械が定義していない粗は、結局これを読まないと見つからない
 *
 * プロファイルは audit-profile.json（ローカルの実行状態・gitignore）に保存する。
 */
import fs from "node:fs";
import path from "node:path";
import { cleanListTitle, __debugSegments } from "../src/lib/title";
import { displayEventType, eventDateLabel } from "../src/lib/date";
import { accumulateUnexplained } from "../src/lib/pageLoss";
import { nowInstant } from "../src/lib/date";

const PROFILE_PATH = path.join(process.cwd(), "audit-profile.json");
const MIRROR_SOURCES = new Set(["channeltono", "rarecheck", "x_watch"]);

type Row = {
  id: number;
  source: string;
  title: string;
  genre: string;
  eventType: string;
  eventDate: Date | null;
  eventDateText: string | null;
  price: string | null;
  imageUrl: string | null;
  highlights: string | null;
};

type SourceProfile = {
  count: number;
  datedRate: number; // 日付が付いている割合
  imageRate: number; // 画像がある割合
  titleLen: number; // 整形後タイトルの平均長
  shrinkRate: number; // 整形で落ちた割合（生 → 整形後）。整形が効かなくなると下がる
  markRate: number; // 「！」「【」等、告知記号を含むタイトルの割合
  genres: Record<string, number>;
};
type Profile = {
  updatedAt: string;
  sources: Record<string, SourceProfile>;
  // ページ別の掲載件数。**参照点を sources と分ける**（下の runDrift のコメント参照）。
  pages?: Record<string, number>;
  // ページ別の掲載 id。件数だけでは「何件減ったか」しか分からず、**減った理由**が出ない。
  // id を持っておくと、消えた行を1件ずつ DB に照会して「日付が過ぎた／収集元から消えた／
  // 説明がつかない」に分けられる（src/lib/pageLoss.ts）。閾値を調整するのではなく、
  // 暦のせいの減少を検査から外すために要る。
  pageIds?: Record<string, number[]>;
  pagesRunAt?: string;
  // 記録した時点の**データの状態**（件数＋最終取得時刻）。
  //
  // これが無かったせいで、2026-08-09 に実際に基準が汚れた: 検証のため /premium を
  // わざと 105→85件に削って audit を回したところ、**その壊れた85件が「直前の実行」として
  // 記録され**、次の実行は 85→105 の増加としか見えなくなった。つまり
  // 「自分のコード変更の影響を見る」ための参照点を、**その実行自身が壊していた**。
  // → データが変わっていないのに基準を進めない。同じデータのまま何度回しても、
  //   比較の相手は「最後にデータが変わったときの状態」のまま固定される。
  pagesFingerprint?: string;
  // ページ別「説明のつかない消失」の**累計**（audit-baseline を受け入れてから今日まで）。
  //
  // 1回の実行の内訳（pageIds の差分）は (14b) が見るが、**基準比の急減**を見る (14) は数日〜
  // 数週間前の基準と比べるので、1日分の内訳では足りない。毎日少しずつ削られる型は
  // 1日ごとの閾値の下をすり抜けるため、**説明のつかない分だけを足し続ける**。
  // `--update-baseline`（＝今の状態を受け入れる）で0に戻す。
  unexplainedSince?: Record<string, number>;
};

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function buildProfile(rows: Row[]): Record<string, SourceProfile> {
  const bySource = new Map<string, Row[]>();
  for (const r of rows) (bySource.get(r.source) ?? bySource.set(r.source, []).get(r.source)!).push(r);
  const out: Record<string, SourceProfile> = {};
  for (const [source, arr] of bySource) {
    const cleaned = arr.map((r) => cleanListTitle(r.source, r.title));
    const genres: Record<string, number> = {};
    for (const r of arr) genres[r.genre] = (genres[r.genre] ?? 0) + 1;
    out[source] = {
      count: arr.length,
      datedRate: arr.filter((r) => r.eventDate).length / arr.length,
      imageRate: arr.filter((r) => r.imageUrl).length / arr.length,
      titleLen: mean(cleaned.map((t) => t.length)),
      shrinkRate: mean(arr.map((r, i) => 1 - cleaned[i].length / Math.max(1, r.title.length))),
      markRate: cleaned.filter((t) => /[！!【（(]/.test(t)).length / arr.length,
      genres,
    };
  }
  return out;
}

function loadProfile(): Profile | null {
  try {
    return JSON.parse(fs.readFileSync(PROFILE_PATH, "utf8")) as Profile;
  } catch {
    return null;
  }
}

/**
 * 直前の実行のページ別 id を読む。**runDrift がファイルを上書きする前に呼ぶこと**
 * （audit.ts は runDrift を最後に呼ぶので、それより前に読む）。
 */
export function readPreviousPageIds(): {
  ids: Record<string, number[]>;
  runAt: string | null;
  fingerprint: string | null;
  unexplainedSince: Record<string, number>;
} {
  const p = loadProfile();
  return {
    ids: p?.pageIds ?? {},
    runAt: p?.pagesRunAt ?? null,
    fingerprint: p?.pagesFingerprint ?? null,
    unexplainedSince: p?.unexplainedSince ?? {},
  };
}

/** 比率の変化がしきい値を超えたものを文章にする。 */
function diffLines(source: string, now: SourceProfile, prev: SourceProfile): string[] {
  const out: string[] = [];
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const rel = (a: number, b: number) => (b === 0 ? (a === 0 ? 0 : 1) : Math.abs(a - b) / b);

  if (prev.count >= 5 && rel(now.count, prev.count) > 0.3)
    out.push(`${source}: 件数 ${prev.count}→${now.count}`);
  if (Math.abs(now.datedRate - prev.datedRate) > 0.2)
    out.push(`${source}: 日付付与率 ${pct(prev.datedRate)}→${pct(now.datedRate)}（日付の読み取りが壊れた疑い）`);
  if (Math.abs(now.imageRate - prev.imageRate) > 0.2)
    out.push(`${source}: 画像付与率 ${pct(prev.imageRate)}→${pct(now.imageRate)}`);
  if (prev.titleLen >= 5 && rel(now.titleLen, prev.titleLen) > 0.25)
    out.push(`${source}: タイトル平均長 ${Math.round(prev.titleLen)}→${Math.round(now.titleLen)}字（収集元の書式が変わった疑い）`);
  if (Math.abs(now.shrinkRate - prev.shrinkRate) > 0.15)
    out.push(
      `${source}: 整形で落とす割合 ${pct(prev.shrinkRate)}→${pct(now.shrinkRate)}（整形が効かなくなった／効きすぎている疑い）`
    );
  if (Math.abs(now.markRate - prev.markRate) > 0.2)
    out.push(`${source}: 告知記号を含むタイトルの割合 ${pct(prev.markRate)}→${pct(now.markRate)}`);

  const allGenres = new Set([...Object.keys(now.genres), ...Object.keys(prev.genres)]);
  for (const g of allGenres) {
    const a = now.genres[g] ?? 0;
    const b = prev.genres[g] ?? 0;
    if (b === 0 && a >= 5) out.push(`${source}: ジャンル「${g}」が新たに ${a}件（分類の振れ／新カテゴリ）`);
    if (a === 0 && b >= 5) out.push(`${source}: ジャンル「${g}」が ${b}件→0件`);
  }
  return out;
}

/**
 * 整形が「捨てた断片」の頻出語。新しい実況表現はまずここに現れる。
 * 既知の型（もう捨てられている）なら表に出ないが、**頻度が上がった断片**は
 * 収集元の書き方が変わったサインで、次に整形をすり抜ける候補でもある。
 */
function droppedFragments(rows: Row[], top = 15): { frag: string; n: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!MIRROR_SOURCES.has(r.source)) continue;
    for (const seg of __debugSegments(r.title)) {
      if (seg.keep) continue;
      const f = seg.orig.trim();
      if (f.length < 3 || f.length > 30) continue;
      counts.set(f, (counts.get(f) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([frag, n]) => ({ frag, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, top);
}

/** 決定的な擬似乱数（同じ日は同じ標本＝差分が読める。日が変われば別の標本を見る）。 */
function seededPick<T>(arr: T[], n: number, seed: number): T[] {
    let s = seed;
    const idx = arr.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      s = (s * 1103515245 + 12345) % 2147483648;
      const j = s % (i + 1);
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    return idx.slice(0, n).map((i) => arr[i]);
}

/**
 * ページ別件数の**直前の実行との差分**。
 *
 * なぜ参照点を sources と分けるか: sources は「収集元の書き方が日々どう変わったか」を見たいので
 * 最後に受け入れた状態（--update-baseline 時）と比べる。対して pages で見たいのは
 * **自分のコード変更が表示範囲を削っていないか**で、これは同じデータに対する前後比較でしか出ない。
 * 毎回書き出して直前の実行と比べれば、データが同じ（同一セッション内）なら差分＝自分の変更の効果になる。
 *
 * 実測でこれが必要だと分かった経緯: 期限切れラベルの修正で /premium を 63→36件（-43%）に
 * 削ってしまったが、既存の急減検査は閾値が「前回の50%未満」だったため**鳴らなかった**。
 * ソース別プロファイルはページを見ていないので、こちらも「目立った変化なし」と言っていた。
 * 判定（閾値）を厳しくするだけでは足りず、**判定しない観測**にページを入れる必要があった。
 */
function pageDriftLines(now: Record<string, number>, prev: Record<string, number> | undefined): string[] {
  if (!prev) return [];
  const lines: string[] = [];
  for (const [name, n] of Object.entries(now)) {
    const p = prev[name];
    if (p == null) {
      lines.push(`${name}: 新しいページ（${n}件）`);
      continue;
    }
    const d = n - p;
    // 件数が少ないページは1件動くだけで割合が跳ねるので、割合と実数の両方を条件にする。
    if (Math.abs(d) >= 3 && Math.abs(d) >= p * 0.05)
      lines.push(`${name}: ${p} → ${n}件（${d > 0 ? "+" : ""}${d} / ${Math.round((d / p) * 100)}%）`);
  }
  for (const name of Object.keys(prev)) if (now[name] == null) lines.push(`${name}: ページが消えた（前回 ${prev[name]}件）`);
  return lines;
}

export function runDrift(
  shown: Row[],
  today: Date,
  update: boolean,
  pageCounts: Record<string, number> = {},
  pageIds: Record<string, number[]> = {},
  /** データの状態（件数＋最終取得時刻）。同じなら基準を進めない。 */
  fingerprint = "",
  /** この実行で出た「説明のつかない消失」（ページ別）。累計に足す。 */
  unexplainedToday: Record<string, number> = {}
): void {
  const prev = loadProfile();
  const now = buildProfile(shown);

  console.log("\n── 前回との変化（未知の型を型を知らずに拾うための観測） ──");
  if (!prev) {
    console.log("  前回のプロファイルがありません（次回から比較します）");
  } else {
    const lines: string[] = [];
    for (const [source, p] of Object.entries(now)) {
      const q = prev.sources[source];
      if (!q) {
        lines.push(`${source}: 新しいソース（${p.count}件）`);
        continue;
      }
      lines.push(...diffLines(source, p, q));
    }
    for (const source of Object.keys(prev.sources)) {
      if (!now[source]) lines.push(`${source}: 表示から消えた（前回 ${prev.sources[source].count}件）`);
    }
    if (lines.length === 0) console.log("  目立った変化なし");
    else for (const l of lines) console.log(`  ⚡ ${l}`);
    console.log(`  （前回の観測: ${prev.updatedAt}）`);
  }

  console.log("\n── ページ別件数の差分（直前の実行と比較＝自分のコード変更が削った分が出る） ──");
  {
    const pl = pageDriftLines(pageCounts, prev?.pages);
    if (!prev?.pages) console.log("  直前の実行の記録がありません（次回から比較します）");
    else if (pl.length === 0) console.log(`  変化なし（${Object.keys(pageCounts).length}ページ）`);
    else {
      for (const l of pl) console.log(`  ⚡ ${l}`);
      console.log(`  （直前の実行: ${prev.pagesRunAt ?? "?"}）`);
    }
  }

  console.log("\n── 整形が捨てた断片の頻出（新しい実況表現はここに先に現れる） ──");
  const frags = droppedFragments(shown);
  if (frags.length === 0) console.log("  なし");
  else for (const { frag, n } of frags) console.log(`  ${String(n).padStart(3)}回  ${frag}`);

  console.log("\n── 表示行のランダム標本（機械が定義していない粗は、これを読むしかない） ──");
  const seed = Number(today.toISOString().slice(0, 10).replace(/-/g, ""));
  for (const r of seededPick(shown, 30, seed)) {
    // 標本は**画面に出るのと同じもの**でなければ意味がない。生の値を出すと、表示層で
    // 弾いているはずの「投稿日: …」が標本にだけ現れ、直したのに直っていないように見える
    // （逆に、表示の粗を見落とす）。表示層と同じ関数を通す。
    // ※ 日付ありの側も表示層を通す。前回は null の場合だけ直して、日付がある場合に
    //   ISO日付をそのまま出していたため、画面が「2026年9月」なのに標本は「2026-09-01」
    //   と特定日を出していた＝**標本を見ても表示の粗に気付けない**状態だった。
    // ※ 種別も同じ。生の eventType を出していたため、表示は「予約終了」に直したのに
    //   標本には「予約受付中 / 2024年2月」と出て、直っていないように見えた（同型3回目）。
    //   **標本に出す値は、1つ残らず表示層の関数を通す。** 生の行を出す枠ではない。
    const date = eventDateLabel(r.eventDate, r.eventDateText, "short") ?? "日付未定";
    const type = displayEventType(r.eventType, r.eventDate, r.eventDateText, today);
    const hl = r.highlights ? ` ｜ ${r.highlights.slice(0, 60)}` : "";
    console.log(`  [${r.genre}/${type}/${date}] ${cleanListTitle(r.source, r.title)}${r.price ? ` ${r.price}` : ""}${hl}`);
  }

  // ソース別プロファイルは --update-baseline のときだけ進める（受け入れた状態と比べるため）。
  //
  // ページ側は「直前の実行」と比べたいが、**毎回無条件に書き出してはいけない**。
  // 同じデータのまま audit を2回回すと、2回目は自分自身と比べることになり差分が消える。
  // さらに悪いことに、壊れた版で1回回すとその壊れた状態が基準になってしまう（実測）。
  // → **データが変わったとき**（＝新しいスクレイプの後）か、明示的に受け入れたときだけ進める。
  const dataChanged = prev?.pagesFingerprint !== fingerprint;
  const advancePages = update || dataChanged || !prev?.pageIds;
  if (!advancePages)
    console.log(
      `\n（ページ比較の基準は据え置き: データが前回の観測から変わっていないため、` +
        `比較の相手は ${prev?.pagesRunAt ?? "?"} 時点のまま）`
    );
  // 消えたページの **最後に載っていた id** は捨てずに持ち越す。
  //
  // 実測 2026-08-11: `/genre/ソフビ・アートトイ` が在籍1件の日付切れで消えた回に、この記録も
  // 一緒に消えた。すると次回以降は「消えた理由を確かめる相手」が存在せず、audit (14a) は
  // 暦のせいだと分かっているものを永久に ERROR と言い続ける（説明できないものは通さない設計
  // なので、記録が無ければ鳴るのが正しい＝**記録の方を残す**のが直し方）。
  //
  // 件数（pages）は持ち越さない。あちらは「前回と比べて何が変わったか」の観測で、持ち越すと
  // 「ページが消えた」を毎回言い続けることになるため。役割が違うので揃えない。
  const carriedPageIds = advancePages
    ? { ...Object.fromEntries(Object.entries(prev?.pageIds ?? {}).filter(([name]) => !(name in pageIds))), ...pageIds }
    : prev?.pageIds;
  // 説明のつかない消失の累計。基準を受け入れた時（--update-baseline）に0へ戻す＝
  // 「最後に受け入れてから、暦でも収集元でも説明のつかない形で何件減ったか」を持つ。
  // 基準を進めない実行（同じデータで2回目）では二重に足さない。
  const nextUnexplained = accumulateUnexplained(
    prev?.unexplainedSince ?? {},
    // 基準を進めない実行（同じデータで2回目）では二重に足さない。
    advancePages ? unexplainedToday : {},
    update
  );

  const profile: Profile = {
    updatedAt: update ? nowInstant().toISOString() : prev?.updatedAt ?? nowInstant().toISOString(),
    sources: update ? now : prev?.sources ?? now,
    pages: advancePages ? pageCounts : prev?.pages,
    pageIds: carriedPageIds,
    unexplainedSince: nextUnexplained,
    pagesRunAt: advancePages ? nowInstant().toISOString() : prev?.pagesRunAt,
    pagesFingerprint: advancePages ? fingerprint : prev?.pagesFingerprint,
  };
  fs.writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2) + "\n");
  if (update) console.log(`\nプロファイルを更新: ${PROFILE_PATH}`);
}
