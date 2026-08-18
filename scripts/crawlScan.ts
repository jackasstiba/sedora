/**
 * スクレイパーを走査して「自前のページ送り」を集める（audit の crawl_discipline が使う）。
 * 単体でも実行できる: `node --import tsx scripts/crawlScan.ts`
 *
 * clockScan と同じ形（grep ではなくファイル読み）。理由もあちらと同じで、正規表現に制御文字を
 * 含むファイルは grep から "binary file" 扱いになり**検査から静かに漏れる**。
 */
import fs from "node:fs";
import path from "node:path";
import { findCrawlViolations, isCrawlLinted, type CrawlViolation } from "../src/lib/crawlLint";
import { listSourceFiles } from "./clockScan";

export function scanRepoCrawlViolations(base = process.cwd()): {
  files: string[];
  violations: CrawlViolation[];
} {
  const files = listSourceFiles(base).filter(isCrawlLinted);
  const violations: CrawlViolation[] = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(base, f), "utf8");
    violations.push(...findCrawlViolations(f, src));
  }
  return { files, violations };
}

if (process.argv[1] && process.argv[1].endsWith("crawlScan.ts")) {
  const { files, violations } = scanRepoCrawlViolations();
  for (const v of violations) console.log(`${v.file}:${v.line}  [${v.rule}]  ${v.snippet}`);
  console.log(`\n走査 ${files.length}ファイル / 違反 ${violations.length}件`);
  process.exit(violations.length ? 1 : 0);
}
