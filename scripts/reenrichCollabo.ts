/**
 * collabo_cafe の highlights / hasLottery を、現在の analyzeCollab ロジックで作り直す。
 *
 * 背景: 通常の `npm run scrape` は「今カテゴリ一覧に載っている記事」だけを upsert するため、
 * 一覧から落ちた（が発売日が未来で表示スコープに残る）古い記事は旧ラベルのまま固着する。
 * enrich ロジック（抽選判定・登場グッズ・関連記事の切り落とし）を変えたら、このスクリプトで
 * 表示スコープの collabo 全件を再取得して作り直す。冪等・非破壊（highlights/hasLottery のみ更新）。
 */
import { prisma } from "../src/lib/prisma";
import { todayJst } from "../src/lib/date";
import { fetchHtml, sleep } from "../src/scrapers/util";
import {
  analyzeCollab,
  extractArticleBody,
  extractOfficialItems,
  extractOfficialSale,
  extractOfficialUrl,
  formatOfficialItems,
  formatSale,
  pickVerifiedEventDate,
} from "../src/scrapers/collaboEnrich";

async function fetchOfficial(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SedoriRadar/1.0)" },
      signal: AbortSignal.timeout(12000),
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

async function main() {
  const today = todayJst();
  const items = await prisma.item.findMany({
    // 表示スコープ（今後＋日付未定）に加え、相場つきの発売済み品も対象。後者は /premium に
    // 載り続けるのに再エンリッチの外だったため、旧ラベル（未確認の「抽選賞品：」）が固着していた。
    where: {
      source: "collabo_cafe",
      OR: [{ eventDate: { gte: today } }, { eventDate: null }, { marketPrice: { not: null } }],
    },
    select: {
      id: true,
      url: true,
      title: true,
      subGenre: true,
      hasLottery: true,
      highlights: true,
      eventDate: true,
      eventDateText: true,
    },
  });
  console.log(`表示スコープの collabo_cafe ${items.length}件を再エンリッチ`);

  let changed = 0;
  let dateFixed = 0;
  for (const it of items) {
    try {
      const html = await fetchHtml(it.url);
      const body = extractArticleBody(html);
      const enr = analyzeCollab(body, it.subGenre);

      // 開催日の裏取り: 一覧の「期間 :」は収集元側で誤っていることがあるため、記事本文の
      // 「開催期間」とタイトルの日付が一致した場合だけ日付を正す（推測では動かさない）。
      const verified = pickVerifiedEventDate(body, it.title, it.eventDate);
      if (verified && verified.date.getTime() !== (it.eventDate?.getTime() ?? -1)) {
        await prisma.item.update({
          where: { id: it.id },
          data: { eventDate: verified.date, eventDateText: verified.text },
        });
        dateFixed++;
        console.log(
          `  #${it.id}: 開催日 ${it.eventDate?.toISOString().slice(0, 10) ?? "未定"}→` +
            `${verified.date.toISOString().slice(0, 10)} «${verified.text}» ${it.title}`
        );
      }

      const official = extractOfficialUrl(html);
      let saleText: string | null = null;
      if (official) {
        const oh = await fetchOfficial(official);
        if (oh) {
          const oi = extractOfficialItems(official, oh);
          saleText = oi ? formatOfficialItems(oi) : null;
          if (!saleText) {
            const s = extractOfficialSale(oh);
            if (s) saleText = formatSale(s);
          }
        }
        await sleep(250);
      }
      const highlights = [enr.highlights, saleText].filter(Boolean).join(" ｜ ") || null;

      if (highlights !== it.highlights || enr.hasLottery !== it.hasLottery) {
        await prisma.item.update({
          where: { id: it.id },
          data: { highlights, hasLottery: enr.hasLottery },
        });
        changed++;
        console.log(`  #${it.id}: hasLottery ${it.hasLottery}→${enr.hasLottery} | ${highlights ?? "(null)"}`);
      }
    } catch (e) {
      console.log(`  #${it.id}: 取得失敗 ${(e as Error).message}`);
    }
    await sleep(350);
  }
  console.log(`\n更新 ${changed}件（うち開催日の訂正 ${dateFixed}件）`);
  await prisma.$disconnect();
}

main();
