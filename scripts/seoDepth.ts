import { prisma } from "../src/lib/prisma";
import { getSitemapItemRefs } from "../src/lib/seo";
import { todayJst } from "../src/lib/date";

// sitemap に載せている item ページが「固有の中身」をどれだけ持っているかを数える。
// 薄いページを大量に申告していないかを見るための計測（検索流入の診断用）。

async function main() {
  const refs = await getSitemapItemRefs();
  const ids = refs.map((r) => r.id);
  const rows = await prisma.item.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, eventDate: true, imageUrl: true, price: true, marketPriceText: true,
      highlights: true, prizes: true, stores: true, salesChannel: true,
      officialUrl: true, hasLottery: true,
    },
  });

  const today = todayJst();
  const has = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== "";
  const pct = (n: number) => `${((n / rows.length) * 100).toFixed(1)}%`;

  const fields = {
    imageUrl: (r: (typeof rows)[number]) => has(r.imageUrl),
    price: (r: (typeof rows)[number]) => has(r.price),
    marketPriceText: (r: (typeof rows)[number]) => has(r.marketPriceText),
    highlights: (r: (typeof rows)[number]) => has(r.highlights),
    prizes: (r: (typeof rows)[number]) => has(r.prizes),
    stores: (r: (typeof rows)[number]) => has(r.stores),
    salesChannel: (r: (typeof rows)[number]) => has(r.salesChannel),
    officialUrl: (r: (typeof rows)[number]) => has(r.officialUrl),
    hasLottery: (r: (typeof rows)[number]) => r.hasLottery === true,
  };

  console.log(`sitemap item pages: ${rows.length}`);
  console.log("-".repeat(52));
  for (const [name, fn] of Object.entries(fields)) {
    const n = rows.filter(fn).length;
    console.log(`${name.padEnd(18)} ${String(n).padStart(5)}  ${pct(n).padStart(7)}`);
  }

  // 「固有の中身」= 画像/価格/相場/賞品/店舗/注目点/一次URL のいずれか
  const substantive = rows.filter(
    (r) =>
      has(r.imageUrl) || has(r.price) || has(r.marketPriceText) || has(r.highlights) ||
      has(r.prizes) || has(r.stores) || has(r.salesChannel) || has(r.officialUrl),
  );
  console.log("-".repeat(52));
  console.log(`substantive (>=1 field): ${substantive.length}  ${pct(substantive.length)}`);
  console.log(`thin (name+date only)  : ${rows.length - substantive.length}  ${pct(rows.length - substantive.length)}`);

  const past = rows.filter((r) => r.eventDate != null && r.eventDate < today).length;
  const future = rows.filter((r) => r.eventDate != null && r.eventDate >= today).length;
  console.log("-".repeat(52));
  console.log(`eventDate past : ${past}  ${pct(past)}`);
  console.log(`eventDate future: ${future}  ${pct(future)}`);
  console.log(`eventDate null : ${rows.length - past - future}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
