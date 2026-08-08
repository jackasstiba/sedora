/**
 * 掲載中の全行を「画面に出るとおりの文字列」で書き出す（`npm run sweep:dump`）。
 *
 * 目的: 不変条件（＝私が過去に見た型）とランダム標本30件では、粗が1件ずつしか出てこない。
 * 全件を人間（あるいは人間の代わりに読むモデル）が一度に通読して、型を知らないまま
 * 「これは変だ」をまとめて拾うための入力を作る。
 *
 * 出す値は**すべて表示層を通す**。生の行を出すと、表示層で直しているものが変に見え、
 * 表示だけの粗を見落とす（これは3回踏んだ）。
 */
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/prisma";
import { loadDisplayedItems } from "../src/lib/pages";
import { cleanListTitle, displaySubGenre } from "../src/lib/title";
import { displayEventType, eventDateLabel, todayJst } from "../src/lib/date";

async function main() {
  const today = todayJst();
  const rows = await loadDisplayedItems();
  rows.sort((a, b) => a.source.localeCompare(b.source) || a.id - b.id);

  const lines = rows.map((r) => {
    const badge = displayEventType(r.eventType, r.eventDate, r.eventDateText, today);
    const date = eventDateLabel(r.eventDate, r.eventDateText, "short") ?? "日付未定";
    const sub = displaySubGenre(r.subGenre);
    const parts = [
      `#${r.id}`,
      r.source,
      r.genre + (sub ? `/${sub}` : ""),
      badge,
      date,
      cleanListTitle(r.source, r.title),
      r.price ?? "",
      r.marketPriceText ?? "",
      r.highlights ? r.highlights.slice(0, 120) : "",
    ];
    return parts.join(" | ");
  });

  const out = path.join(process.cwd(), "sweep-dump.txt");
  fs.writeFileSync(out, `# 掲載 ${rows.length}件 / 基準日 ${today.toISOString().slice(0, 10)}\n` + lines.join("\n") + "\n");
  console.log(`${rows.length}件を書き出しました: ${out}`);
}

main().finally(() => prisma.$disconnect());
