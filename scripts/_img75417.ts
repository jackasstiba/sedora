import { prisma } from "../src/lib/prisma";
async function main() {
  const r = await prisma.item.findUnique({ where: { id: 75417 } });
  if (!r) return console.log("なし");
  console.log(`#${r.id} [${r.source}] ${r.title}`);
  console.log("imageUrl:", r.imageUrl);
  console.log("url:", r.url);
  console.log("officialUrl:", r.officialUrl);
  // 同じ画像を使っている他の行
  if (r.imageUrl) {
    const same = await prisma.item.findMany({ where: { imageUrl: r.imageUrl }, select: { id: true, source: true, title: true } });
    console.log(`同じ画像を使っている行: ${same.length}件`);
    for (const s of same.slice(0, 12)) console.log(`   #${s.id} [${s.source}] ${s.title.slice(0, 50)}`);
  }
}
main();
