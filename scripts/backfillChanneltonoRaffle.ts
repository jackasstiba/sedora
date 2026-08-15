// channeltono の「表示中の抽選行なのに応募先(officialUrl)が無い」行に、記事本文から
// 既知抽選プラットフォームのリンクを付与する。
//
// なぜ scraper 本体だけでは足りないか（2026-08-15 実測）: scraper は一覧3ページの窓しか
// 巡回しないため、投稿が窓から流れた行は**再訪されず永久に応募先なしのまま**になる
// （「一度取得した行は詳細を再取得しない」型＝figisland_pb の凍結と同じ）。表示中で
// 応募先の無い行だけを対象に、ここで記事を再訪する。scrape.ts の定常経路から毎回呼ぶ。
import type { PrismaClient } from "../src/generated/prisma/client";
import { extractRaffleUrl } from "../src/scrapers/channeltono";
import { fetchHtml, sleep } from "../src/scrapers/util";

export async function backfillChanneltonoRaffleUrls(prisma: PrismaClient): Promise<number> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const rows = await prisma.item.findMany({
    where: {
      source: "channeltono",
      officialUrl: null,
      eventType: "抽選",
      eventDate: { gte: today }, // 表示され得る（未来の）抽選だけ。過去は導線の意味が無い
    },
    select: { id: true, url: true, title: true },
  });
  let added = 0;
  for (const r of rows) {
    try {
      const article = await fetchHtml(r.url);
      const raffleUrl = extractRaffleUrl(article);
      if (raffleUrl) {
        await prisma.item.update({ where: { id: r.id }, data: { officialUrl: raffleUrl } });
        added++;
        console.log(`[channeltono] 応募先付与 #${r.id} ${r.title.slice(0, 40)} -> ${raffleUrl}`);
      }
    } catch {
      // 記事が消えていても掲載自体には影響させない
    }
    await sleep(400);
  }
  if (rows.length) console.log(`[channeltono] 応募先バックフィル: 対象${rows.length}件 / 付与${added}件`);
  return added;
}
