import { prisma } from "../src/lib/prisma";
import { SNKRDUNK_RELEASE_TITLE } from "../src/scrapers/snkrdunk";

// snkrdunkの「編集記事（◯選/ランキング/コラム）」をDBから削除する一回きりのクリーンアップ。
// スクレイパー側(snkrdunk.ts)は既に発売エントリのみ採用するよう修正済みだが、
// upsertは既存レコードを消さないため、過去に取り込んだ編集記事がDBに残り続ける。
// これらは価格が記事内の一商品を拾うだけで無意味（例: NB992「6選」に¥42,900）、
// 日付もカレンダー上の任意日になり“今日発売”の誤情報になるため削除する。
async function main() {
  const rows = await prisma.item.findMany({
    where: { source: "snkrdunk" },
    select: { id: true, title: true, price: true },
  });
  const editorial = rows.filter((r) => !SNKRDUNK_RELEASE_TITLE.test(r.title));

  console.log(`snkrdunk ${rows.length}件中、編集記事 ${editorial.length}件を削除します:`);
  for (const r of editorial) {
    console.log(`  ✂ #${r.id} [${r.price ?? "-"}] ${r.title.slice(0, 50)}`);
  }

  if (editorial.length > 0) {
    const result = await prisma.item.deleteMany({
      where: { id: { in: editorial.map((r) => r.id) } },
    });
    console.log(`\n${result.count}件を削除しました。`);
  } else {
    console.log("削除対象はありませんでした。");
  }

  await prisma.$disconnect();
}

main();
