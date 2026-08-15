/**
 * 時計まわりの自己テスト（`npm run audit:clock`）。**同じ日本時間の日なら、何時に・
 * どのTZの箱で回しても、日付にかかわる出力は1バイトも変わらない**ことを実測で確かめる。
 *
 * なぜこの道具が要るか（2026-08-16 ミス24）:
 *  ・締切が1日早く保存されていた原因は「日本時間 09:00 より前に巡回したから」だった。
 *    **昼に動かすと再現しない**ので、目視でも、その日の audit でも、翌日の audit でも出ない。
 *  ・`npm run audit:tomorrow` は「暦を進める」道具で、**時刻**は動かさない。この型は映らない。
 *  ・実行環境のTZ依存（ローカル時刻ゲッター）も同じで、JSTの箱で開発している限り出ない。
 *
 * 何を見るか:
 *  1. `scripts/clockProbe.ts` … 壁時計を読む面を全部呼ぶ。同じ日本時間の日の中で、
 *     時刻（JST 00:00 / 06:39 / 08:59 / 09:00 / 23:59）を変えて出力が一致するか。
 *     さらに TZ（UTC / Asia/Tokyo / America/Los_Angeles）を変えて一致するか。
 *  2. `npm run audit:selftest` … 218件の自己テストを、時刻とTZをずらして2回実行し、
 *     出力が一致するか（＝既存のテスト自体が壁時計に依存していないか）。
 *  3. 時計の差し替えが**実際に効いていること**（##NOW 行が指定した瞬間になっているか）。
 *     効いていない検査は「常に一致＝常に緑」になり、持っているだけで何も守らない。
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CLOCK_GROUPS } from "./clockProbe";

const TZS = ["UTC", "Asia/Tokyo", "America/Los_Angeles"];
const PRELOAD = pathToFileURL(path.join(process.cwd(), "scripts", "fakeClock.mjs")).href;

type Run = { tz: string; now: string; stdout: string; code: number };

function runNode(script: string, tz: string, nowIso: string): Run {
  const r = spawnSync(
    process.execPath,
    ["--import", PRELOAD, "--import", "tsx", script],
    {
      env: { ...process.env, TZ: tz, HATSUKORE_FAKE_NOW: nowIso, HATSUKORE_SIMULATE_TODAY: "" },
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }
  );
  if (r.error) throw r.error;
  return { tz, now: nowIso, stdout: r.stdout ?? "", code: r.status ?? 1 };
}

/**
 * 子プロセスの出力を「瞬間ごとのブロック」に切り分ける。
 *
 * ⚠️ ここを間違えると道具が空振りする。最初の実装は**子プロセス同士**を比較していたが、
 * 子は自分の中で全部の瞬間を回すので、どの子も同じ文字列を出す＝**常に一致＝常に緑**だった。
 * 実際、ミス24を再現（cardChusen の基準日を UTC に戻す）しても exit 0 のまま素通りした。
 * 比較しなければならないのは「同じ子の中の、瞬間ごとのブロック同士」。
 */
type Block = { group: string; jstDay: string; iso: string; actualNow: string; lines: string[] };

function parseBlocks(stdout: string): Block[] {
  const blocks: Block[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith("##NOW")) {
      const [, group, jstDay, iso, actualNow] = line.split("\t");
      blocks.push({ group, jstDay, iso, actualNow, lines: [] });
      continue;
    }
    if (blocks.length) blocks[blocks.length - 1].lines.push(line);
  }
  return blocks;
}

/** 差分の最初の数行を人が読める形で返す。 */
function firstDiffs(a: string[], b: string[], max = 4): string[] {
  const out: string[] = [];
  for (let i = 0; i < Math.max(a.length, b.length) && out.length < max; i++) {
    if (a[i] !== b[i]) out.push(`      期待: ${a[i] ?? "(無し)"}\n      実際: ${b[i] ?? "(無し)"}`);
  }
  return out;
}

function main() {
  const problems: string[] = [];
  let comparisons = 0;

  const expectedInstants = CLOCK_GROUPS.reduce((n, g) => n + g.instants.length, 0);
  const probeRuns = TZS.map((tz) => runNode(path.join("scripts", "clockProbe.ts"), tz, CLOCK_GROUPS[0].instants[0]));
  const blocksByTz = new Map<string, Block[]>();

  // ── 1) 時計の差し替えが効いているか（この道具自身が空振りしていないことの確認）──
  for (const r of probeRuns) {
    if (r.code !== 0) problems.push(`clockProbe が TZ=${r.tz} で異常終了した（exit ${r.code}）\n${r.stdout.slice(-500)}`);
    const blocks = parseBlocks(r.stdout);
    blocksByTz.set(r.tz, blocks);
    if (blocks.length !== expectedInstants) {
      problems.push(`TZ=${r.tz}: 観測できた瞬間が ${blocks.length}個（期待 ${expectedInstants}個）＝プローブが回りきっていない`);
      continue;
    }
    for (const b of blocks) {
      if (Date.parse(b.iso) !== Date.parse(b.actualNow))
        problems.push(`TZ=${r.tz}: 時計の差し替えが効いていない（指定 ${b.iso} なのに実際は ${b.actualNow}）`);
      if (b.lines.length === 0) problems.push(`TZ=${r.tz} / ${b.iso}: 観測が0行`);
    }
  }

  // ── 2) 同じ日本時間の日の中で、**時刻**を変えても出力が同じか ──
  for (const [tz, blocks] of blocksByTz) {
    for (const g of CLOCK_GROUPS) {
      const inGroup = blocks.filter((b) => b.group === g.name);
      const base = inGroup[0];
      if (!base) continue;
      for (const b of inGroup.slice(1)) {
        comparisons++;
        if (b.lines.join("\n") !== base.lines.join("\n")) {
          problems.push(
            `日本時間 ${g.jstDay}（${g.name}）: TZ=${tz} で ${base.iso} と ${b.iso} の出力が違う\n` +
              `      ＝巡回した「時刻」でサイトの日付が変わる（ミス24と同じ型）\n` +
              firstDiffs(base.lines, b.lines).join("\n")
          );
        }
      }
    }
  }

  // ── 3) **TZ** を変えても出力が同じか ──
  const baseTz = TZS[0];
  const baseBlocks = blocksByTz.get(baseTz) ?? [];
  for (const tz of TZS.slice(1)) {
    const blocks = blocksByTz.get(tz) ?? [];
    for (let i = 0; i < Math.min(baseBlocks.length, blocks.length); i++) {
      comparisons++;
      if (blocks[i].lines.join("\n") !== baseBlocks[i].lines.join("\n")) {
        problems.push(
          `TZ が変わると出力が変わる（${baseTz} ↔ ${tz} / ${blocks[i].iso}）\n` +
            `      ＝実行環境のTZで日付が変わる（本番Vercelは UTC、手元は JST）\n` +
            firstDiffs(baseBlocks[i].lines, blocks[i].lines).join("\n")
        );
      }
    }
  }

  // ── 4) 既存の自己テスト（218件）が壁時計に依存していないか ──
  const selftestA = runNode(path.join("scripts", "auditSelftest.ts"), "UTC", "2026-08-15T21:39:06Z");
  const selftestB = runNode(path.join("scripts", "auditSelftest.ts"), "America/Los_Angeles", "2026-08-16T14:59:59Z");
  comparisons++;
  if (selftestA.stdout !== selftestB.stdout) {
    const a = selftestA.stdout.split(/\r?\n/);
    const b = selftestB.stdout.split(/\r?\n/);
    problems.push("audit:selftest の結果が実行時刻・TZで変わる\n" + firstDiffs(a, b).join("\n"));
  }
  if (selftestA.code !== 0 || selftestB.code !== 0)
    problems.push("audit:selftest が時計を差し替えると失敗する（NG が出ている）");

  const probeRows = [...blocksByTz.values()].reduce((n, bs) => n + bs.reduce((m, b) => m + b.lines.length, 0), 0);
  console.log(
    `検査した組み合わせ: ${TZS.length}TZ × ${expectedInstants}時刻（${CLOCK_GROUPS.length}グループ） ` +
      `＝ 観測 ${probeRows}行 ／ 比較 ${comparisons}回 ＋ selftest 2通り`
  );
  for (const p of problems) console.log(`\n【❌ERROR】${p}`);
  console.log(
    `\n==== 時計の自己テスト: ${problems.length === 0 ? "同じ日本時間の日なら出力は不変" : `${problems.length}件の不一致`} ====`
  );
  process.exit(problems.length ? 1 : 0);
}

main();
