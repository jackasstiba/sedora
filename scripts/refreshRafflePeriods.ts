import type { prisma as PrismaInstance } from "../src/lib/prisma";
import { fetchHtml, sleep } from "../src/scrapers/util";
import { extractRafflePeriod } from "../src/scrapers/raffleKujiEnrich";

/**
 * 一覧から落ちた raffle_kuji の行の締切を、**応募ページを開いて**引き直す。
 *
 * 直す対象の型（2026-08-20 実測）: 収集元の一覧は開催中のくじを全部は載せない。
 * 一覧から外れた行は巡回で更新されないので、**そのとき保存した締切のまま居座る**（ミス13）。
 * ところがその古い締切は、一覧カードの「M月D日 23:59 まで」＝応募ページの本当の受付終了
 * （翌朝 08:59）より1日早い。実測: 全31件のうち **11件**が一覧から落ちた行で、うち4件は
 * まだ先の日付＝画面に**1日早い締切**を出したままだった（#24365 は掲載 8/23 ↔ 応募ページ 8/24）。
 *
 * 「一覧に無い＝終わった」ではないので消さない。**応募ページが今なんと言っているか**だけを見て、
 * 期間が読めた行の日付を引き直す。読めなければ触らない（読めないことを根拠にしない）。
 *
 * 単体で呼べるようにしてある理由は cleanupTakaraTomyEnded と同じ:
 * 36分の巡回を回さないと一度も動かせない掃除は、入れた日に確かめられない。
 */
export async function refreshRafflePeriods(
  prisma: typeof PrismaInstance,
  liveIds: string[],
  opts: { fetchHtml?: (url: string) => Promise<string>; maxChecks?: number } = {}
): Promise<{ checked: number; updated: number; unreadable: number }> {
  const get = opts.fetchHtml ?? fetchHtml;
  const live = new Set(liveIds);
  const rows = await prisma.item.findMany({
    where: { source: "raffle_kuji" },
    select: { id: true, sourceId: true, title: true, url: true, eventDate: true, eventDateText: true },
  });
  const targets = rows
    .filter((r: { sourceId: string }) => !live.has(r.sourceId))
    // 巡回がほぼ空振りした回に全件フェッチしにいかないための歯止め。
    .slice(0, opts.maxChecks ?? 100);

  let updated = 0;
  let unreadable = 0;
  for (const r of targets) {
    let period: { text: string; end: Date } | null = null;
    try {
      period = extractRafflePeriod(await get(r.url));
    } catch {
      period = null; // 404・一時失敗＝判定材料が無い。触らない
    }
    if (!period) {
      unreadable++;
      await sleep(400);
      continue;
    }
    const sameDate = r.eventDate ? r.eventDate.getTime() === period.end.getTime() : false;
    if (!sameDate || r.eventDateText !== period.text) {
      await prisma.item.update({
        where: { id: r.id },
        data: { eventDate: period.end, eventDateText: period.text },
      });
      if (!sameDate)
        console.log(
          `  引き直し #${r.id} ${r.eventDate?.toISOString().slice(0, 10) ?? "なし"} → ` +
            `${period.end.toISOString().slice(0, 10)}（応募ページ「${period.text}」） ${r.title.slice(0, 30)}`
        );
      updated++;
    }
    await sleep(400);
  }
  return { checked: targets.length, updated, unreadable };
}
