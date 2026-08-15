/**
 * 既に相場が付いているアイテムを現行ロジックで検算し直す（`npm run prices:recheck`）。
 *
 * 背景: `scrape:prices` は「相場が古い/未取得のもの」を優先して**新規に**付けていくため、
 * 一度付いた誤った相場（BOX/カートン価格・別シリーズ・駿河屋の「予約」価格）は
 * そのまま居座り続ける。相場は降順の「相場・プレ値ランキング」に出るので、誤りほど
 * 上位に並ぶ＝最も目立つ場所が壊れる。マッチ判定を直したら、このスクリプトで既存分を洗う。
 *
 * ・対象は駿河屋由来のみ。X巡回で人が裏取りした相場（marketSource="x"）は触らない。
 * ・検算で該当なしになったものは相場を消す（誤った相場を出し続けるより出さない方が正しい）。
 * ・通信失敗は throw で飛んでくるので、その回は据え置く（消さない）。
 */
import { prisma } from "../src/lib/prisma";
import { fetchSurugayaPrice, LINE_LEVEL_SOURCES } from "../src/scrapers/surugayaPrice";
import { sleep } from "../src/scrapers/util";
import { nowInstant } from "../src/lib/date";

const isDry = process.argv.includes("--dry");

async function main() {
  const rows = await prisma.item.findMany({
    where: { marketSource: "surugaya", marketPrice: { not: null } },
    select: { id: true, source: true, title: true, marketPrice: true, marketPriceText: true },
    orderBy: { marketPrice: "desc" },
  });
  console.log(`[recheck] 駿河屋由来の相場 ${rows.length}件を検算${isDry ? "（dry run）" : ""}`);

  let kept = 0;
  let updated = 0;
  let cleared = 0;
  let skipped = 0;
  for (const r of rows) {
    // 商品ラインの総称しか持たないソースは、そもそも相場を付けられない（取得せず取り下げ）。
    if (LINE_LEVEL_SOURCES.has(r.source)) {
      cleared++;
      console.log(`  ✗ #${r.id} ${r.marketPriceText} → 取り下げ（商品ラインの総称）  ${r.title.slice(0, 40)}`);
      if (!isDry) {
        await prisma.item.update({
          where: { id: r.id },
          data: { marketPrice: null, marketPriceText: null, marketUrl: null, marketSource: null, marketCheckedAt: nowInstant() },
        });
      }
      continue;
    }

    let mp: Awaited<ReturnType<typeof fetchSurugayaPrice>>;
    try {
      mp = await fetchSurugayaPrice(r.title);
    } catch (e) {
      skipped++;
      console.log(`  … #${r.id} 取得失敗のため据え置き (${(e as Error).message.slice(0, 50)})`);
      await sleep(800);
      continue;
    }

    if (mp && mp.price === r.marketPrice && mp.priceText === r.marketPriceText) {
      kept++;
    } else if (mp) {
      updated++;
      console.log(`  ✎ #${r.id} ${r.marketPriceText} → ${mp.priceText}  ${r.title.slice(0, 45)}`);
      if (!isDry) {
        await prisma.item.update({
          where: { id: r.id },
          data: {
            marketPrice: mp.price,
            marketPriceText: mp.priceText,
            marketUrl: mp.url,
            marketCheckedAt: nowInstant(),
          },
        });
      }
    } else {
      cleared++;
      console.log(`  ✗ #${r.id} ${r.marketPriceText} → 取り下げ  ${r.title.slice(0, 45)}`);
      if (!isDry) {
        await prisma.item.update({
          where: { id: r.id },
          data: {
            marketPrice: null,
            marketPriceText: null,
            marketUrl: null,
            marketSource: null,
            marketCheckedAt: nowInstant(),
          },
        });
      }
    }
    await sleep(800);
  }

  console.log(`\n[recheck] 維持 ${kept} / 更新 ${updated} / 取り下げ ${cleared} / 据え置き ${skipped}`);
  await prisma.$disconnect();
}

main();
