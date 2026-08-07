/**
 * 語彙に無いジャンル名を、正式な語彙（itemFilter.ts の GENRE_ORDER）へ寄せる一度きりの移行。
 *
 * 背景: スクレイパーごとに独自のジャンル名を書いていたため「ゲーム」と「家電・ゲーム機」が
 * 併存し、同じ性質の商品が2つのジャンルに散っていた（片方は絞り込みチップにも出ない）。
 * スクレイパー側は語彙に揃えたが、既存レコードは通常の更新では書き変わらないので明示的に直す。
 * 冪等（対象が無ければ0件）。
 */
import { prisma } from "../src/lib/prisma";
import { GENRE_ORDER } from "../src/lib/itemFilter";

const RENAME: Record<string, string> = {
  ゲーム: "家電・ゲーム機",
};

async function main() {
  for (const [from, to] of Object.entries(RENAME)) {
    if (!GENRE_ORDER.includes(to)) throw new Error(`移行先 "${to}" が語彙にありません`);
    const res = await prisma.item.updateMany({ where: { genre: from }, data: { genre: to } });
    console.log(`「${from}」→「${to}」: ${res.count}件`);
  }
  const rows = await prisma.item.groupBy({ by: ["genre"], _count: true });
  const unknown = rows.filter((r) => !GENRE_ORDER.includes(r.genre));
  console.log(
    unknown.length
      ? `語彙外が残っています: ${unknown.map((r) => `${r.genre}(${r._count})`).join(", ")}`
      : "語彙外のジャンルはありません"
  );
  await prisma.$disconnect();
}

main();
