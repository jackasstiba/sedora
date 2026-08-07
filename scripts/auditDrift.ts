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
import { eventDateLabel } from "../src/lib/date";

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
type Profile = { updatedAt: string; sources: Record<string, SourceProfile> };

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

export function runDrift(shown: Row[], today: Date, update: boolean): void {
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
    const date = eventDateLabel(r.eventDate, r.eventDateText, "short") ?? "日付未定";
    const hl = r.highlights ? ` ｜ ${r.highlights.slice(0, 60)}` : "";
    console.log(`  [${r.genre}/${r.eventType}/${date}] ${cleanListTitle(r.source, r.title)}${r.price ? ` ${r.price}` : ""}${hl}`);
  }

  if (update) {
    const profile: Profile = { updatedAt: new Date().toISOString(), sources: now };
    fs.writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2) + "\n");
    console.log(`\nプロファイルを更新: ${PROFILE_PATH}`);
  }
}
