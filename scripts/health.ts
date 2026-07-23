import fs from "node:fs";
import path from "node:path";
import type { ScraperResult } from "../src/scrapers";

// スクレイプの「静かな取りこぼし/破損」を検知するための健全性チェック。
// 各ソースの取得件数・日付付与率を前回スナップショットと比較し、急減・ゼロ落ち・
// 日付付与率の急落を警告する。エラーで落ちたソースは常に警告。
// スナップショットは scrape_health.json（ローカル実行状態、gitignore済み）に保存。

const SNAPSHOT_PATH = path.join(process.cwd(), "scrape_health.json");
const LOG_PATH = path.join(process.cwd(), "scrape_health.log");

// 差分取得型など「0が正常」なソースは件数チェックの対象外にする（エラーのみ警告）。
const VOLATILE_SOURCES = new Set(["figisland_pb"]);

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

function saveSnapshot(stats: Record<string, SourceStat>): void {
  const snap: Snapshot = { updatedAt: new Date().toISOString(), sources: stats };
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snap, null, 2));
}

/**
 * スクレイプ結果を診断し、警告を表示＋ログ追記する。
 * @returns 警告があれば true
 */
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

    const mark = p ? "🟢" : "⚪"; // 前回基準なしは白
    console.log(`${mark} ${base}`);
  }

  if (warnings.length > 0) {
    console.log(`\n⚠️  ${warnings.length}件の警告:`);
    warnings.forEach((w) => console.log(`   - ${w}`));
    const stamp = new Date().toISOString();
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

  saveSnapshot(stats);
  return warnings.length > 0;
}
