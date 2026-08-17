import type { prisma as PrismaInstance } from "../src/lib/prisma";
import { todayJst } from "../src/lib/date";
import { POKEMON_GOODS_RECENT_DAYS, isRecentPokemonGoods } from "../src/scrapers/pokemonGoods";

/**
 * 「直近◯日の新着だけ載せる」と決めたソースから、窓を過ぎた行を落とす。
 *
 * なぜ独立した関数なのか（2026-08-17）: この掃除を `scrape.ts` の中に直接書いていたとき、
 * **実行するには24分の巡回を丸ごと回すしかなかった**ので、入れた当日は一度も動かせず、
 * 「仕組みで担保した」と書けるだけの状態になっていた（[[System/rules]] 観点L＝
 * 登録しただけ・書いただけは動いていないのと同じ。実際 run_scrape.bat が3週間死んでいた前科がある）。
 * 名前を付けて外に出すと、巡回を回さずにそのまま呼んで確かめられる。
 *
 * 直す対象の型（ミス13）: `pokemon_goods` の30日 cutoff は**取り込み側にしか無く**、
 * 一度入った行は消えなかった。実測 2026-08-17: 掲載105件（サイト全体の7%）が全て過去日で、
 * 最古52日前・中央24日前。`eventDate` を持たない設計なので「日付未定」の顔で今後の一覧に
 * 居座り、期限切れを落とす `isStalePlan` では 0/105 しか落ちていなかった。
 *
 * 呼び出し側の約束: **巡回が成功した回だけ呼ぶ**（失敗した回に呼ぶと、取りこぼしを
 * 「窓を過ぎた」と誤認する経路がいずれ生えるため、判断を呼び出し側に固定しておく）。
 */
export async function cleanupPokemonGoodsWindow(
  prisma: typeof PrismaInstance,
  today: Date = todayJst()
): Promise<{ deleted: number; kept: number }> {
  const rows = await prisma.item.findMany({
    where: { source: "pokemon_goods" },
    select: { id: true, eventDateText: true },
  });
  const stale = rows.filter((r: { id: number; eventDateText: string | null }) =>
    !isRecentPokemonGoods(r.eventDateText, today)
  );
  if (stale.length > 0) {
    await prisma.item.deleteMany({ where: { id: { in: stale.map((r) => r.id) } } });
    console.log(
      `[pokemon_goods] 新着の窓（${POKEMON_GOODS_RECENT_DAYS}日）を過ぎた ${stale.length}件を削除`
    );
  }
  return { deleted: stale.length, kept: rows.length - stale.length };
}
