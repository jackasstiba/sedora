import { prisma } from "../src/lib/prisma";
import { getSitemapItemRefs } from "../src/lib/seo";
import { eventDateLabel, eventPeriodText, isEventPast, todayJst } from "../src/lib/date";
import { eventDateHeading } from "../src/lib/itemFilter";
import { cleanListTitle, itemPageTitle, venueForTitle } from "../src/lib/title";
import { parseStoresJson } from "../src/lib/stores";

// 商品ページ <title> の実測（`node --env-file-if-exists=.env --import tsx scripts/seoTitles.ts`）。
//
// 2026-08-18: Search Console の実測で、このサイトに付いている検索需要が
// 「コラボ・ポップアップ × 地名/店舗」だと分かった（「ナガノマーケット 仙台」91表示・クリック0、
// /items/45827 単体で233表示＝全体の40%）。会場と期間をタイトルに載せる変更を入れたので、
// **変更前後を並べて、何件が・どう変わるかを出す前に数える**。
//   ・会場が載る件数（載せられない＝羅列/注記の件数も）
//   ・期間が載る件数（開始日しか出していなかった行がどれだけあるか）
//   ・タイトル長の分布（Googleの表示は概ね30〜35文字）
//   ・タイトルの重複（同じ <title> が並ぶと薄いページ判定を受けやすい）

async function main() {
  const refs = await getSitemapItemRefs();
  const rows = await prisma.item.findMany({
    where: { id: { in: refs.map((r) => r.id) } },
    select: {
      id: true, source: true, title: true, eventType: true, eventDate: true,
      eventDateText: true, hasLottery: true, genre: true, stores: true,
    },
  });
  const today = todayJst();
  const pct = (n: number) => `${((n / rows.length) * 100).toFixed(1)}%`;

  const built = rows.map((r) => {
    const name = cleanListTitle(r.source, r.title);
    const past = isEventPast(r.eventDate, r.eventDateText, today);
    const heading = eventDateHeading(r.eventType, r.eventDateText, past);
    const shortDate = eventDateLabel(r.eventDate, r.eventDateText, "short");
    const longDate = eventDateLabel(r.eventDate, r.eventDateText, "long");
    const venue = venueForTitle(parseStoresJson(r.stores), name);
    const period = eventPeriodText(r.eventDate, r.eventDateText);
    const hasLottery = r.hasLottery === true;
    return {
      id: r.id, genre: r.genre, venue, period,
      hasStores: (parseStoresJson(r.stores)?.length ?? 0) > 0,
      before: itemPageTitle({ name, heading, date: shortDate, hasLottery }),
      after: itemPageTitle({
        name, heading, date: venue ? longDate : shortDate, hasLottery, period, venue,
      }),
    };
  });

  const changed = built.filter((b) => b.before !== b.after);
  const withVenue = built.filter((b) => b.venue);
  const venueDropped = built.filter((b) => !b.venue && b.hasStores);
  const withPeriod = built.filter((b) => b.period);

  console.log(`sitemap item pages: ${rows.length}`);
  console.log("-".repeat(64));
  console.log(`変わるページ       : ${changed.length}\t${pct(changed.length)}`);
  console.log(`会場が載る         : ${withVenue.length}\t${pct(withVenue.length)}`);
  console.log(`  └ storesはあるが載せない(羅列/注記/長すぎ/重複): ${venueDropped.length}\t${pct(venueDropped.length)}`);
  console.log(`期間が載る         : ${withPeriod.length}\t${pct(withPeriod.length)}`);

  console.log("-".repeat(64));
  const lensOf = (list: { before?: string; after?: string }[], key: "before" | "after") =>
    list.map((b) => (b[key] ?? "").length).sort((a, b) => a - b);
  for (const key of ["before", "after"] as const) {
    const l = lensOf(built, key);
    const over = l.filter((n) => n > 40).length;
    console.log(
      `${key} タイトル長: 中央値 ${l[Math.floor(l.length / 2)]} / 最長 ${l[l.length - 1]} / 40字超 ${over} (${pct(over)})`
    );
  }

  const dupe = (key: "before" | "after") => {
    const m = new Map<string, number>();
    for (const b of built) m.set(b[key], (m.get(b[key]) ?? 0) + 1);
    return [...m.values()].filter((n) => n > 1).reduce((a, n) => a + n, 0);
  };
  console.log(`重複タイトル: before ${dupe("before")} → after ${dupe("after")}`);

  console.log("-".repeat(64));
  console.log("会場が載る行のジャンル内訳:");
  const byGenre = new Map<string, number>();
  for (const b of withVenue) byGenre.set(b.genre ?? "(なし)", (byGenre.get(b.genre ?? "(なし)") ?? 0) + 1);
  for (const [k, v] of [...byGenre.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(12)} ${String(v).padStart(5)}`);
  }

  console.log("-".repeat(64));
  console.log("変わる例 15件（before → after）:");
  for (const b of changed.slice(0, 15)) {
    console.log(`  - ${b.before}`);
    console.log(`  + ${b.after}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
