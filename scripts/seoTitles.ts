import { prisma } from "../src/lib/prisma";
import { getSitemapItemRefs } from "../src/lib/seo";
import { eventDateLabel, isEventPast, todayJst } from "../src/lib/date";
import { eventDateHeading } from "../src/lib/itemFilter";
import { cleanListTitle, itemPageTitle } from "../src/lib/title";

// 商品ページ <title> の実測。狙っているクエリの形になっているかを数える。
//  ・修飾語（発売日/抽選 等）が何%のページに載るか
//  ・タイトル長の分布（Google の表示は概ね30〜35文字）
//  ・タイトルの重複（同じ <title> が並ぶと薄いページ判定を受けやすい）

async function main() {
  const refs = await getSitemapItemRefs();
  const rows = await prisma.item.findMany({
    where: { id: { in: refs.map((r) => r.id) } },
    select: {
      id: true, source: true, title: true, eventType: true, eventDate: true,
      eventDateText: true, hasLottery: true,
    },
  });
  const today = todayJst();
  const pct = (n: number) => `${((n / rows.length) * 100).toFixed(1)}%`;

  const built = rows.map((r) => {
    const name = cleanListTitle(r.source, r.title);
    const past = isEventPast(r.eventDate, r.eventDateText, today);
    const heading = eventDateHeading(r.eventType, r.eventDateText, past);
    const date = eventDateLabel(r.eventDate, r.eventDateText, "short");
    return {
      id: r.id, name, heading, date,
      old: `${name} | ハツコレ`,
      neu: itemPageTitle({ name, heading, date, hasLottery: r.hasLottery === true }),
    };
  });

  const nameLens = built.map((b) => b.name.length).sort((a, b) => a - b);
  const median = nameLens[Math.floor(nameLens.length / 2)];
  console.log(`sitemap item pages: ${rows.length}`);
  console.log(`表示名の長さ: 中央値 ${median} / 最長 ${nameLens[nameLens.length - 1]}`);

  console.log("-".repeat(60));
  const withHeading = built.filter((b) => b.neu !== b.old && b.heading && b.neu.includes(`の${b.heading}`));
  const withDate = built.filter((b) => b.date);
  const withLottery = built.filter((b) => b.neu.includes("抽選あり"));
  const unchanged = built.filter((b) => b.neu === b.old);
  console.log(`修飾語が載る   : ${withHeading.length}  ${pct(withHeading.length)}`);
  console.log(`日付が載る     : ${withDate.length}  ${pct(withDate.length)}`);
  console.log(`「抽選あり」   : ${withLottery.length}  ${pct(withLottery.length)}`);
  console.log(`旧と同じ(変化なし): ${unchanged.length}  ${pct(unchanged.length)}`);

  console.log("-".repeat(60));
  const lens = built.map((b) => b.neu.length).sort((a, b) => a - b);
  console.log(`新タイトル長: 中央値 ${lens[Math.floor(lens.length / 2)]} / 最長 ${lens[lens.length - 1]}`);

  const dupe = (list: { neu: string }[], key: (b: { neu: string }) => string) => {
    const m = new Map<string, number>();
    for (const b of list) m.set(key(b), (m.get(key(b)) ?? 0) + 1);
    return [...m.values()].filter((n) => n > 1).reduce((a, n) => a + n, 0);
  };
  console.log(`重複タイトル: 旧 ${dupe(built, (b) => (b as never as { old: string }).old)} → 新 ${dupe(built, (b) => b.neu)}`);

  console.log("-".repeat(60));
  console.log("見出し語の内訳:");
  const byHeading = new Map<string, number>();
  for (const b of built) byHeading.set(b.heading ?? "(なし)", (byHeading.get(b.heading ?? "(なし)") ?? 0) + 1);
  for (const [k, v] of [...byHeading.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(10)} ${String(v).padStart(5)}  ${pct(v)}`);
  }

  console.log("-".repeat(60));
  console.log("サンプル20件:");
  for (const b of built.slice(0, 20)) console.log(`  ${b.neu}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
