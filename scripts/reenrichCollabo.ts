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
    where: { source: "collabo_cafe", OR: [{ eventDate: { gte: today } }, { eventDate: null }] },
    select: { id: true, url: true, subGenre: true, hasLottery: true, highlights: true },
  });
  console.log(`表示スコープの collabo_cafe ${items.length}件を再エンリッチ`);

  let changed = 0;
  for (const it of items) {
    try {
      const html = await fetchHtml(it.url);
      const enr = analyzeCollab(extractArticleBody(html), it.subGenre);

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
  console.log(`\n更新 ${changed}件`);
  await prisma.$disconnect();
}

main();
