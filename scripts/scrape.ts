import { prisma } from "../src/lib/prisma";
import { runAllScrapers } from "../src/scrapers";
import type { ScrapeContext } from "../src/scrapers/types";
import { checkHealth } from "./health";
import { cleanTitle } from "../src/scrapers/util";
import { mergePrizeEnrichment } from "../src/lib/prizes";
import { backfillChanneltonoRaffleUrls } from "./backfillChanneltonoRaffle";
import { backfillDisplayText } from "./backfillDisplayText";
import { isGenericImageUrl } from "../src/scrapers/imagePick";
import { monthPrecisionFromTitle, todayJst } from "../src/lib/date";
import { nowInstant } from "../src/lib/date";

// 「受付中」が入れ替わり、消えたら載せ続けるべきでないソース。今回未検出＝受付終了として削除する。
const RECONCILE_SOURCES = new Set(["nyuka_now", "card_chusen"]);

async function main() {
  // figisland_pb は詳細ページ取得型。「最後に詳細を取り直した時刻」を渡して古い順に一巡させる。
  // （scrapedAt は upsert のたびに更新されるので、詳細を取った回だけ進む＝そのまま最終取得時刻になる）
  const pbRows = await prisma.item.findMany({
    where: { source: "figisland_pb" },
    select: { sourceId: true, scrapedAt: true },
  });
  const ctx: ScrapeContext = {
    detailFetchedAt: new Map(pbRows.map((r) => [r.sourceId, r.scrapedAt.getTime()])),
  };

  const results = await runAllScrapers(ctx);
  let total = 0;

  for (const { source, items, error } of results) {
    if (error) {
      console.error(`[${source}] scrape failed: ${error}`);
      continue;
    }

    for (const raw of items) {
      // 配信元タイトルの日付告知・編集タグを落として商品名として読みやすくする。
      // あわせて「収集元が画像なしの代わりに配る定型画像」（no-image.png / empty.png / ロゴ）を
      // ここで落とす。**imageUrl が埋まっていると「画像あり」に数えられる**ので、他所サイトの
      // 灰色タイルが商品画像の顔をして並び、監査にも掛からなかった（実測 2026-08-15:
      // トレカ速報40件が no-image_150x150.png、トレカマップ8件が empty.png）。
      // 各スクレイパーに同じ判定を書かせない＝新しいソースでも自動で効かせるために保存側に置く。
      const title = cleanTitle(raw.title);
      const item = {
        ...raw,
        title,
        imageUrl: raw.imageUrl && !isGenericImageUrl(raw.imageUrl) ? raw.imageUrl : null,
        // 商品名が「12月発売」と言っているのに日付欄が空、を保存側で塞ぐ。各スクレイパーに
        // 同じ判定を書かせない＝新しいソースでも自動で効く（画像の汎用判定と同じ置き場）。
        // 日は作らない（eventDate は触らない）＝月精度のまま出す。
        eventDateText:
          raw.eventDate || raw.eventDateText
            ? raw.eventDateText
            : monthPrecisionFromTitle(title, todayJst()),
      };
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
          salesChannel: item.salesChannel ?? null,
          prizes,
          stores: item.stores ?? null,
          scrapedAt: nowInstant(),
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

  // 巡回窓（一覧3ページ）から流れた抽選行の応募先を、記事再訪で埋める（定常経路）。
  await backfillChanneltonoRaffleUrls(prisma);

  // 保存済みの表示文字列の修復（相対日付の凍結解除・月精度の補完）。巡回窓から流れた行は
  // 二度と上書きされないので、スクレイパー側の修正だけでは既存行に届かない。
  await backfillDisplayText(prisma);

  checkHealth(results);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
