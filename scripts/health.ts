import fs from "node:fs";
import { crawledCount } from "../src/scrapers/crawl";
import path from "node:path";
import type { ScraperResult } from "../src/scrapers";
import { nowInstant } from "../src/lib/date";

// スクレイプの「静かな取りこぼし/破損」を検知するための健全性チェック。
// 各ソースの取得件数・日付付与率を前回スナップショットと比較し、急減・ゼロ落ち・
// 日付付与率の急落を警告する。エラーで落ちたソースは常に警告。
// スナップショットは scrape_health.json（ローカル実行状態、gitignore済み）に保存。

const SNAPSHOT_PATH = path.join(process.cwd(), "scrape_health.json");
const LOG_PATH = path.join(process.cwd(), "scrape_health.log");

// 差分取得型など「0が正常」なソースは件数チェックの対象外にする（エラーのみ警告）。
// nyuka_now は「今まさに受付中の抽選」だけを載せるため、受付終了で件数が 0〜数件に
// 揺れるのが正常（抽選が同時に走っていない期間もある）。件数チェックの対象外にする。
// card_chusen も受付中の抽選だけを載せる＝大型弾の締切通過で数日のうちに件数が大きく
// 揺れるのが正常。件数検査の代わりに audit の intake_face_dead（0件落ち検知）で見る。
const VOLATILE_SOURCES = new Set(["figisland_pb", "nyuka_now", "tenbaiquest", "card_chusen"]);

// 前回比でこの割合を下回ったら急減とみなす
const DROP_RATIO = 0.5;
// この件数以上あったソースだけ急減判定する（小さいソースのノイズ回避）
const MIN_PREV_FOR_DROP = 5;
// 日付付与率がこのポイント以上下がったら警告（パーサー破損の兆候）
const DATE_RATE_DROP = 0.4;

type SourceStat = { count: number; withDate: number; dateRate: number };
type Snapshot = { updatedAt: string; sources: Record<string, SourceStat> };

export function computeStats(results: ScraperResult[]): Record<string, SourceStat> {
  const stats: Record<string, SourceStat> = {};
  for (const { source, items } of results) {
    const withDate = items.filter((i) => i.eventDate != null).length;
    stats[source] = {
      count: items.length,
      withDate,
      dateRate: items.length ? withDate / items.length : 0,
    };
  }
  return stats;
}

function loadSnapshot(): Snapshot | null {
  try {
    return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8")) as Snapshot;
  } catch {
    return null; // 初回は基準なし
  }
}

/**
 * 次回の基準にする件数を決める（純関数・selftest対象）。
 *
 * 🔴 2026-09-12 実測: gunpla_resale が 9/4 に「ゼロ落ち（前回34件）」と鳴った後、基準が
 * **0件で上書きされた**ので、9/5 以降は 0→0 で毎日 🟢 になり、9/12 まで8日間誰も気付かなかった
 * （sofvi も同じ）。落ちた日に1回鳴るだけの網は、その日に人が見ていなければ無いのと同じ。
 * → 急減・ゼロ落ちした回は**前回の件数を基準として持ち越す**。復旧するまで毎日鳴り続ける。
 * 「静かな日」が本当に続くソース（VOLATILE_SOURCES）は従来どおり今回の値で上書きする。
 */
export function nextBaseline(cur: SourceStat, prev: SourceStat | undefined, volatile: boolean): SourceStat {
  if (volatile || !prev || prev.count < MIN_PREV_FOR_DROP) return cur;
  if (cur.count < prev.count * DROP_RATIO) return prev;
  return cur;
}

function saveSnapshot(stats: Record<string, SourceStat>, prev: Snapshot | null): void {
  const sources: Record<string, SourceStat> = {};
  for (const [src, cur] of Object.entries(stats)) {
    sources[src] = nextBaseline(cur, prev?.sources[src], VOLATILE_SOURCES.has(src));
  }
  const snap: Snapshot = { updatedAt: nowInstant().toISOString(), sources };
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snap, null, 2));
}

/**
 * スクレイプ結果を診断し、警告を表示＋ログ追記する。
 * @returns 警告があれば true
 */
/**
 * 採用0件のソースについて、**「静かな日」と「壊れた」を見分ける**。
 *
 * 実測 2026-08-19: `mita_draw` は前回1件しか無かったため `MIN_PREV_FOR_DROP`(=5) に届かず、
 * 何度0件になっても 🟢 のまま。収集元を実際に開いて確かめたところ、最新記事は前日の
 * NIKE MIND 001（既に取り込み済み）で**本当に受付中が無い日**だった＝0件が正しい。
 * ただし壊れた場合も同じ 🟢 になる。**一覧から記事が取れたかどうか**だけが両者を分ける。
 */
export function zeroAdoptionVerdict(
  adopted: number,
  crawled: number | null
): { level: "error" | "info"; message: string } | null {
  if (adopted > 0) return null;
  // 巡回の記事数が分からないソース（crawlPages を通らない・label が source 名と違う）は判定しない。
  if (crawled === null) return null;
  if (crawled === 0)
    return { level: "error", message: "一覧そのものが0件（入口が壊れた疑い。件数の大小に関係なく異常）" };
  return {
    level: "info",
    message: `記事${crawled}件は取れているが採用0件（受付中が無い＝静かな日の可能性。収集元を開いて確かめる）`,
  };
}

/**
 * 突き合わせ削除の**崩落ガード**（純関数・selftest対象）。
 *
 * 🔴 実測 2026-09-12: タカラトミーモールが応答せず、巡回が3本の一覧のうち1本ぶん（24件）だけを
 * 返した回に、突き合わせが「一覧に無い＝在庫切れ」として **56件を削除**した（朝は186件）。
 * 取れなかった（部分成功）と無かった（本当に消えた）は別物で、消す側は区別できない。
 * → 既存の過半を一度に消す突き合わせは**やらずに警告する**。本当に半分以上が消える日
 * （大型発売の翌日等）は翌日の巡回でも同じ結果になるので、1日遅れるだけで害は無い。
 * 少数（20件未満）は揺れが大きいので対象外（0件→数件の小ソースを止めない）。
 */
export function reconcileCollapsed(existing: number, doomed: number): boolean {
  return existing >= 20 && doomed * 2 > existing;
}

export function checkHealth(results: ScraperResult[]): boolean {
  const stats = computeStats(results);
  const prev = loadSnapshot();
  const warnings: string[] = [];

  console.log("\n--- 健全性チェック ---");
  for (const { source, error } of results) {
    const s = stats[source];
    const p = prev?.sources[source];
    const pct = Math.round(s.dateRate * 100);
    const base = `[${source}] ${s.count}件 (日付${pct}%)`;

    if (error) {
      warnings.push(`${source}: スクレイプ失敗 (${error})`);
      console.log(`🔴 ${base} ← エラー`);
      continue;
    }

    if (!VOLATILE_SOURCES.has(source) && p && p.count >= MIN_PREV_FOR_DROP) {
      if (s.count === 0) {
        warnings.push(`${source}: 件数がゼロに落ちた (前回${p.count}件)`);
        console.log(`🔴 ${base} ← ゼロ落ち (前回${p.count})`);
        continue;
      }
      if (s.count < p.count * DROP_RATIO) {
        warnings.push(`${source}: 件数が急減 ${p.count}→${s.count}件`);
        console.log(`🟠 ${base} ← 急減 (前回${p.count})`);
        continue;
      }
      if (p.dateRate >= 0.5 && s.dateRate < p.dateRate - DATE_RATE_DROP) {
        const pp = Math.round(p.dateRate * 100);
        warnings.push(`${source}: 日付付与率が急落 ${pp}%→${pct}% (パーサー破損の疑い)`);
        console.log(`🟠 ${base} ← 日付付与率が急落 (前回${pp}%)`);
        continue;
      }
    }

    // 採用0件は、件数の大小に関係なく「静かな日」か「壊れた」のどちらか。
    // 一覧から記事が取れたかで分ける（前回件数のしきい値では小さいソースが永久に沈黙する）。
    const zero = zeroAdoptionVerdict(s.count, crawledCount(source));
    if (zero) {
      if (zero.level === "error") {
        warnings.push(`${source}: ${zero.message}`);
        console.log(`🔴 ${base} ← ${zero.message}`);
      } else {
        console.log(`⚪ ${base} ← ${zero.message}`);
      }
      continue;
    }

    const mark = p ? "🟢" : "⚪"; // 前回基準なしは白
    console.log(`${mark} ${base}`);
  }

  if (warnings.length > 0) {
    console.log(`\n⚠️  ${warnings.length}件の警告:`);
    warnings.forEach((w) => console.log(`   - ${w}`));
    const stamp = nowInstant().toISOString();
    const logLine = warnings.map((w) => `${stamp}\t${w}`).join("\n") + "\n";
    try {
      fs.appendFileSync(LOG_PATH, logLine);
      console.log(`   → ${LOG_PATH} に記録`);
    } catch {
      /* ログ書き込み失敗は致命的でないので握りつぶす */
    }
  } else {
    console.log("すべて正常。");
  }

  saveSnapshot(stats, prev);
  return warnings.length > 0;
}
