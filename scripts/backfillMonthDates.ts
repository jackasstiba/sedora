// 「文言は月まで言っているのに eventDate=null」の既存行に、monthPlanDate の規約
// （未来月＝月初・当月＝null のまま）で月精度の eventDate を付けるバックフィル。
//
// 背景（2026-08-22 実測）: collabo_cafe / torecasoku / kujimap / ichiban_kuji / onepiece_card は
// 月精度の日付を eventDate に変換しておらず、「2026年10月発売予定」のような未来月の商品が
// 186件、日付なし＝「発売中」ビューに混ざっていた。スクレイパー側は同日に修正済みだが、
// 巡回は停止中（2026-08-18〜）なので既存行はこのスクリプトで直す。
//
// 安全策:
//  ・対象は「発売月の文言」を持つソースだけに限定（channeltono の「投稿日: …」や
//    hololive_shop の発送月のような、発売日でない文言から日付を作らない）。
//  ・文言に暦日（◯月◯日）が含まれる行は触らない（月初を作ると date_text_mismatch になる。
//    その型は別問題として手で見る）。
//  ・null で上書きしない（当月＝monthPlanDate が null の行はスキップ＝既存の設計どおり）。
//
// 実行: node --env-file-if-exists=.env --import tsx scripts/backfillMonthDates.ts        （dry-run）
//       node --env-file-if-exists=.env --import tsx scripts/backfillMonthDates.ts --apply （書き込み）

import { prisma } from "@/lib/prisma";
import { todayJst } from "@/lib/date";
import { extractDates } from "@/lib/dateText";
import { monthPlanDate } from "@/scrapers/util";

// eventDateText が「発売（開催）月」を意味するソースだけ。
const RELEASE_TEXT_SOURCES = [
  "collabo_cafe",
  "torecasoku",
  "kujimap",
  "ichiban_kuji",
  "onepiece_card",
  "gashapon",
  "medicom_toy",
];

async function main() {
  const apply = process.argv.includes("--apply");
  const today = todayJst();

  const rows = await prisma.item.findMany({
    where: {
      eventDate: null,
      eventDateText: { not: null },
      source: { in: RELEASE_TEXT_SOURCES },
    },
    select: { id: true, source: true, eventDateText: true, title: true },
  });

  const bySource = new Map<string, number>();
  let skippedHasDay = 0;
  let skippedCurrentMonth = 0;
  let skippedNoYm = 0;
  const updates: { id: number; date: Date; label: string }[] = [];

  for (const r of rows) {
    const text = r.eventDateText!;
    if (extractDates(text).length > 0) {
      // 暦日入りの文言なのに eventDate が無い＝月初で埋めると文言と食い違う。対象外。
      skippedHasDay++;
      continue;
    }
    const ym = text.match(/(\d{4})年\s*(\d{1,2})月/);
    if (!ym) {
      skippedNoYm++;
      continue;
    }
    const d = monthPlanDate(Number(ym[1]), Number(ym[2]), today);
    if (!d) {
      skippedCurrentMonth++; // 当月＝null のまま（既存の設計どおり）
      continue;
    }
    updates.push({ id: r.id, date: d, label: `[${r.source} #${r.id}] ${text} ← ${r.title.slice(0, 36)}` });
    bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
  }

  console.log(`対象候補(日付なし・文言あり・対象ソース): ${rows.length}件`);
  console.log(
    `更新: ${updates.length}件 ／ スキップ: 暦日入り文言=${skippedHasDay} 当月(null維持)=${skippedCurrentMonth} 年月なし=${skippedNoYm}`
  );
  for (const [s, n] of [...bySource.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${s}: ${n}件`);
  console.log("");
  for (const u of updates.slice(0, 20)) console.log(`  ${u.label} → ${u.date.toISOString().slice(0, 10)}`);
  if (updates.length > 20) console.log(`  …他${updates.length - 20}件`);

  if (!apply) {
    console.log("\n（dry-run。書き込むには --apply を付ける）");
    return;
  }
  for (const u of updates) {
    await prisma.item.update({ where: { id: u.id }, data: { eventDate: u.date } });
  }
  console.log(`\n✓ ${updates.length}件を更新した`);
}

main().then(() => process.exit(0));
