import { prisma } from "../src/lib/prisma";
import { scrapeIchibanKuji } from "../src/scrapers/ichibanKuji";
import { cleanTitle } from "../src/scrapers/util";
import { nowInstant } from "../src/lib/date";
import { mergePrizeEnrichment } from "../src/lib/prizes";

// 一番くじだけを対象に再収集し、各賞ラインナップ（highlights）と hasLottery を付与する
// 差分更新スクリプト。全13ソースを回す `npm run scrape` を待たずに、抽選賞品の深掘りだけを
// 素早く本番へ反映するため（scrape:prices 等と同じ targeted 運用）。upsert なので非破壊。
// 実行: npm run scrape:kuji
async function main() {
  const items = await scrapeIchibanKuji();
  let enriched = 0;
  let carried = 0;
  for (const raw of items) {
    const item = { ...raw, title: cleanTitle(raw.title) };
    if (item.highlights) enriched++;
    // **後付けの二次相場を、この差分更新で消さない。** scrape.ts は mergePrizeEnrichment を
    // 通しているのに、一番くじだけを回すこのスクリプトは prizes をそのまま上書きしていた
    // ＝相場を付けた直後に `npm run scrape:kuji` を1回回すだけで消える経路が残っていた
    // （src/lib/prizes.ts の mergePrizeEnrichment に書いてある事故そのもの・2026-08-22 に発見）。
    const existing = await prisma.item.findUnique({
      where: { source_sourceId: { source: item.source, sourceId: item.sourceId } },
      select: { prizes: true },
    });
    const mergedPrizes = mergePrizeEnrichment(existing?.prizes, item.prizes) ?? null;
    if (mergedPrizes && mergedPrizes !== (item.prizes ?? null)) carried++;
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
        highlights: item.highlights ?? null,
        hasLottery: item.hasLottery ?? null,
        prizes: mergedPrizes,
        scrapedAt: nowInstant(),
      },
    });
  }
  console.log(`一番くじ ${items.length}件を保存（各賞ラインナップ付与 ${enriched}件 / 既存の二次相場を引き継いだ ${carried}件）`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
