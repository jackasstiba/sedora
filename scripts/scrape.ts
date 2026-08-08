import { prisma } from "../src/lib/prisma";
import { runAllScrapers } from "../src/scrapers";
import { checkHealth } from "./health";
import { cleanTitle } from "../src/scrapers/util";
import { mergePrizeEnrichment } from "../src/lib/prizes";

// 「受付中」が入れ替わり、消えたら載せ続けるべきでないソース。今回未検出＝受付終了として削除する。
const RECONCILE_SOURCES = new Set(["nyuka_now"]);

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
      // 各賞の二次相場は別スクリプト（scrape:kuji:prices）が後付けするので、
      // 巡回で取り直した prizes をそのまま書くと毎回消える。賞ラベルで突合して引き継ぐ。
      let prizes = item.prizes ?? null;
      if (prizes) {
        const existing = await prisma.item.findUnique({
          where: { source_sourceId: { source: item.source, sourceId: item.sourceId } },
          select: { prizes: true },
        });
        prizes = mergePrizeEnrichment(existing?.prizes, prizes) ?? null;
      }
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
          // 一覧完結型スクレイパー(channeltono/rarecheck等)は imageUrl=null を返すため、
          // そのまま書くと scrape:images でバックフィルした画像を毎回の巡回で null に潰す。
          // null のときは undefined＝更新しない（既存画像を温存）、値があるときだけ更新する。
          imageUrl: item.imageUrl ?? undefined,
          highlights: item.highlights ?? null,
          hasLottery: item.hasLottery ?? null,
          officialUrl: item.officialUrl ?? null,
          prizes,
          stores: item.stores ?? null,
          scrapedAt: new Date(),
        },
      });
      total++;
    }

    // 「受付中」が入れ替わるソース（nyuka_now＝家電・ゲーム機抽選）は、今回の巡回で
    // 見つからなくなった＝受付終了した行を消す（過去の抽選が居座らないように）。
    // 巡回失敗(error)時はここに来ないので、取りこぼしで全消しする事故は起きない。
    if (RECONCILE_SOURCES.has(source)) {
      const liveIds = items.map((i) => i.sourceId);
      const del = await prisma.item.deleteMany({
        where: { source, sourceId: { notIn: liveIds } },
      });
      if (del.count > 0) console.log(`[${source}] 受付終了 ${del.count}件を削除`);
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
