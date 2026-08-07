// 一時: stores JSON の重複を調べる。使い捨て。
import { prisma } from "../src/lib/prisma";

async function main() {
  const rows = await prisma.item.findMany({ where: { stores: { not: null } } });
  for (const r of rows) {
    const arr = JSON.parse(r.stores!) as { name: string; url: string; form?: string; when?: string }[];
    const keys = arr.map((s) => `${s.name}|${s.url}|${s.when ?? ""}|${s.form ?? ""}`);
    const dupExact = keys.length - new Set(keys).size;
    const nameWhen = arr.map((s) => `${s.name}|${s.when ?? ""}`);
    const dupNameWhen = nameWhen.length - new Set(nameWhen).size;
    if (dupExact || dupNameWhen) {
      console.log(`#${r.id} [${r.source}] ${r.title.slice(0, 40)} : ${arr.length}店 / 完全重複${dupExact} / 名前+時刻重複${dupNameWhen}`);
      for (const s of arr) console.log(`    ${s.name} | ${s.when ?? "-"} | ${s.url.slice(0, 70)}`);
    }
  }
  await prisma.$disconnect();
}
main();
