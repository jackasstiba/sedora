/**
 * リポジトリ全体を走査して「時計を読む行」の違反を集める（audit の clock_discipline が使う）。
 * 単体でも実行できる: `node --import tsx scripts/clockScan.ts`
 *
 * grep ではなくファイル読みで判定する理由: scripts/audit.ts は正規表現に制御文字を
 * 生で含むため grep から見ると "binary file" 扱いになり、**検査から静かに漏れる**。
 */
import fs from "node:fs";
import path from "node:path";
import { findClockViolations, isClockLinted, type ClockViolation } from "../src/lib/clockLint";

const ROOTS = ["src", "scripts"];
const EXTS = new Set([".ts", ".tsx", ".mjs", ".js"]);
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build"]);

export function listSourceFiles(base = process.cwd()): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".") && e.name !== ".githooks") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(full);
      } else if (EXTS.has(path.extname(e.name))) {
        out.push(path.relative(base, full).replace(/\\/g, "/"));
      }
    }
  };
  for (const r of ROOTS) {
    const dir = path.join(base, r);
    if (fs.existsSync(dir)) walk(dir);
  }
  return out.sort();
}

export function scanRepoClockViolations(base = process.cwd()): {
  files: string[];
  violations: ClockViolation[];
} {
  const files = listSourceFiles(base).filter(isClockLinted);
  const violations: ClockViolation[] = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(base, f), "utf8");
    violations.push(...findClockViolations(f, src));
  }
  return { files, violations };
}

if (process.argv[1] && process.argv[1].endsWith("clockScan.ts")) {
  const { files, violations } = scanRepoClockViolations();
  for (const v of violations) console.log(`${v.file}:${v.line}  [${v.rule}]  ${v.snippet}`);
  console.log(`\n走査 ${files.length}ファイル / 違反 ${violations.length}件`);
  process.exit(violations.length ? 1 : 0);
}
