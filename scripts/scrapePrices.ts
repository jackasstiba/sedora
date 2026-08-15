import { prisma } from "../src/lib/prisma";
import { fetchSurugayaPrice, LINE_LEVEL_SOURCES } from "../src/scrapers/surugayaPrice";
import { sleep } from "../src/scrapers/util";
import { nowInstant } from "../src/lib/date";

// ハツコレの各アイテムに「相場（駿河屋の中古/新品価格）」をベストエフォートで付与する。
// 未発売品は駿河屋に市場が無く null のまま（＝サイトでは相場を出さない）。
// 使い方: npm run scrape:prices -- [--limit N] [--genre トレカ] [--all]
//   デフォルトは相場が意味を持ちやすいジャンル(トレカ/フィギュア/一番くじ/プラモ)を対象。

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

const DEFAULT_GENRES = ["トレカ", "フィギュア", "一番くじ", "プラモ"];
const SLEEP_MS = 800;

async function main() {
  const limit = Number(arg("limit") ?? "60");
  const genre = arg("genre");

  // 商品ラインの総称しか持たないソース（抽選アグリ）は、SKU単位の相場が原理的に付けられない。
  const notLineLevel = { source: { notIn: [...LINE_LEVEL_SOURCES] } };
  const where = genre
    ? { genre, ...notLineLevel }
    : hasFlag("all")
      ? notLineLevel
      : { genre: { in: DEFAULT_GENRES }, ...notLineLevel };

  // 相場が古い/未取得のものを優先（marketCheckedAt が null → 古い順）
  const items = await prisma.item.findMany({
    where,
    orderBy: [{ marketCheckedAt: { sort: "asc", nulls: "first" } }, { id: "desc" }],
    take: limit,
    select: { id: true, title: true },
  });

  console.log(`[prices] target ${items.length} items (genre=${genre ?? (hasFlag("all") ? "ALL" : DEFAULT_GENRES.join("/"))})`);

  let matched = 0;
  let miss = 0;
  for (const it of items) {
    try {
      const mp = await fetchSurugayaPrice(it.title);
      await prisma.item.update({
        where: { id: it.id },
        data: {
          marketPrice: mp?.price ?? null,
          marketPriceText: mp?.priceText ?? null,
          marketUrl: mp?.url ?? null,
          marketSource: mp?.source ?? null,
          marketCheckedAt: nowInstant(),
        },
      });
      if (mp) {
        matched++;
        console.log(`  ✓ ${mp.priceText}  ${it.title.slice(0, 40)}`);
      } else {
        miss++;
      }
    } catch (e) {
      miss++;
      console.warn(`  ! ${it.id} ${String(e).slice(0, 80)}`);
    }
    await sleep(SLEEP_MS);
  }

  console.log(`[prices] done. matched=${matched} miss=${miss}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
