import { prisma } from "../src/lib/prisma";
import { classifyGenre } from "../src/scrapers/util";

// 詳細を再取得せず、既存レコードの genre だけを最新の分類ロジックで振り直す。
// 一覧完結型ソース（figisland/koretore/torecamap/snkrdunk）は本来のジャンルが固定なので対象外。
const RECLASSIFY_SOURCES = ["figisland_pb", "rarecheck", "channeltono"];

async function main() {
  let changed = 0;
  for (const source of RECLASSIFY_SOURCES) {
    const items = await prisma.item.findMany({
      where: { source },
      select: { id: true, title: true, subGenre: true, genre: true },
    });
    for (const item of items) {
      const basis = source === "figisland_pb" ? item.title : `${item.subGenre ?? ""} ${item.title}`;
      const genre = classifyGenre(basis);
      if (genre !== item.genre) {
        await prisma.item.update({ where: { id: item.id }, data: { genre } });
        changed++;
      }
    }
  }
  console.log(`${changed} 件の genre を更新しました`);
  await prisma.$disconnect();
}

main();
