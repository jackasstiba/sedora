import { prisma } from "../src/lib/prisma";
import { runAllScrapers } from "../src/scrapers";
import { checkHealth } from "./health";
import { cleanTitle } from "../src/scrapers/util";

async function main() {
  // figisland_pb は詳細ページ取得型。既に価格まで取れているものは再取得しない。
  const pricedPb = await prisma.item.findMany({
    where: { source: "figisland_pb", price: { not: null } },
    select: { sourceId: true },
  });
  const ctx = { skipDetailIds: new Set(pricedPb.map((p) => p.sourceId)) };

  const results = await runAllScrapers(ctx);
  let total = 0;

  for (const { source, items, error } of results) {
    if (error) {
      console.error(`[${source}] scrape failed: ${error}`);
      continue;
    }

    for (const raw of items) {
      // 配信元タイトルの日付告知・編集タグを落として商品名として読みやすくする
      const item = { ...raw, title: cleanTitle(raw.title) };
      await prisma.item.upsert({
        where: { source_sourceId: { source: item.source, sourceId: item.sourceId } },
        create: item,
        update: {
          title: item.title,
          genre: item.genre,
          subGenre: item.subGenre,
          eventType: item.eventType,
          eventDate: item.eventDate,
          eventDateText: item.eventDateText,
          price: item.price,
          url: item.url,
          imageUrl: item.imageUrl,
          scrapedAt: new Date(),
        },
      });
      total++;
    }

    console.log(`[${source}] ${items.length}件処理`);
  }

  console.log(`合計 ${total} 件を保存しました`);

  checkHealth(results);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
