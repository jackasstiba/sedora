import { prisma } from "../src/lib/prisma";
import { sleep } from "../src/scrapers/util";

// 画像なし商品(ちゃんねらー速報/レアチェック等のXミラー系)に、元記事の og:image を後付けする。
// 一覧完結型の各スクレイパーは記事本文を開かないため画像を持てない。これを別途バックフィルする。
//
// 注意: ちゃんねらー速報の og:image は記事の9割が「ブログ共通の汎用バナー」で、商品画像ではない。
// そのまま使うと同じバナーが何十枚も並ぶ。→ 取得した og:image の出現頻度を数え、
// 「多数の記事で共有される画像＝デフォルトバナー」は不採用にし、固有画像だけを採用する。
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const SOURCES = ["channeltono", "rarecheck"];
const SHARED_IMAGE_MAX = 3; // この回数を超えて共有される画像はデフォルトバナー扱いで不採用
const RATE_MS = 250;

// og:image が無い記事でCMSが挿す汎用アイコン/デフォルト画像。商品画像ではないので不採用。
// 例: rarecheck が featured image 未設定の記事に返す /uploads/2018/11/Binoculars-256.png。
const DEFAULT_ICON_RE =
  /binoculars|no[-_]?image|noimage|default|placeholder|logo|icon|avatar|gravatar|blank|dummy|\/uploads\/201[0-8]\//i;

function extractOgImage(html: string): string | null {
  const m =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  const img = m ? m[1] : null;
  if (img && DEFAULT_ICON_RE.test(img)) return null; // デフォルトアイコンは商品画像でない
  return img;
}

async function main() {
  const items = await prisma.item.findMany({
    where: { source: { in: SOURCES }, imageUrl: null },
    select: { id: true, url: true, source: true },
  });
  console.log(`画像なし対象: ${items.length}件（${SOURCES.join(", ")}）`);

  // 1st pass: og:image を取得して (id → 画像URL) を集めつつ、画像URLの出現頻度を数える。
  const found: { id: number; img: string }[] = [];
  const freq = new Map<string, number>();
  let fetched = 0;
  for (const it of items) {
    try {
      const res = await fetch(it.url, { headers: { "User-Agent": UA } });
      if (res.ok) {
        const img = extractOgImage(await res.text());
        if (img) {
          found.push({ id: it.id, img });
          freq.set(img, (freq.get(img) ?? 0) + 1);
        }
      }
    } catch {
      /* 個別失敗は無視して続行 */
    }
    fetched++;
    if (fetched % 25 === 0) console.log(`  ...${fetched}/${items.length} 取得`);
    await sleep(RATE_MS);
  }

  // 2nd pass: 共有されすぎる画像(=デフォルトバナー)を除き、固有画像だけを保存。
  const rejected = new Set(
    [...freq.entries()].filter(([, c]) => c > SHARED_IMAGE_MAX).map(([u]) => u)
  );
  let updated = 0;
  for (const { id, img } of found) {
    if (rejected.has(img)) continue;
    await prisma.item.update({ where: { id }, data: { imageUrl: img } });
    updated++;
  }

  console.log(
    `\nog:image取得 ${found.length}件 / デフォルトバナー除外 ${rejected.size}種 / 画像を付与 ${updated}件`
  );
  if (rejected.size > 0) {
    console.log("除外した共有画像:");
    for (const u of rejected) console.log(`  x${freq.get(u)}  ${u}`);
  }
  await prisma.$disconnect();
}

main();
