import { prisma } from "../../src/lib/prisma";
import { X_WATCH_SOURCE, X_MARKET_SOURCE, scoreMatch, distinctiveTokens } from "../../src/lib/xWatch";
import { X_WATCHLIST } from "../../src/data/xWatchlist";
import { nowInstant } from "../../src/lib/date";

// X巡回パイプラインの自己点検。DB書き込みはしない（--fix 指定時のみ潜在重複を統合）。
// 使い方: npm run x:audit [-- --fix]
//   ① 巡回リスト整合性（重複ハンドル・不正な tier/cluster）
//   ② x_watch のカバレッジ（件数・ジャンル別・相場付与数）
//   ③ ソース被りの取りこぼし検出＝x_watch 商品に他ソースの強い相棒(scoreMatch>=0.6)がいれば、
//      本来は既存へ統合すべき重複候補として報告（--fix で相場を移して x_watch 側を削除）

const hasFlag = (name: string) => process.argv.includes(`--${name}`);
const DUP_THRESHOLD = 0.6; // 監査は誤検出を避けるため取り込み時(0.5)より厳しめ

async function main() {
  const fix = hasFlag("fix");

  // ① 巡回リスト整合性 ───────────────────────────────
  console.log("── ① 巡回リスト整合性 ──");
  const handleCount = new Map<string, number>();
  for (const a of X_WATCHLIST) handleCount.set(a.handle, (handleCount.get(a.handle) ?? 0) + 1);
  const dupHandles = [...handleCount.entries()].filter(([, n]) => n > 1);
  const validTiers = new Set(["price", "alert"]);
  const validClusters = new Set(["cross", "pokeca", "tcg", "kuji", "figure", "sneaker", "onepiece", "dbz", "yugioh_mtg"]);
  const badEnum = X_WATCHLIST.filter((a) => !validTiers.has(a.tier) || !validClusters.has(a.cluster));
  console.log(`  アカウント数: ${X_WATCHLIST.length}`);
  console.log(`  重複ハンドル: ${dupHandles.length ? dupHandles.map(([h, n]) => `@${h}×${n}`).join(", ") : "なし ✓"}`);
  console.log(`  不正な tier/cluster: ${badEnum.length ? badEnum.map((a) => "@" + a.handle).join(", ") : "なし ✓"}`);
  const byCluster = new Map<string, number>();
  for (const a of X_WATCHLIST) byCluster.set(a.cluster, (byCluster.get(a.cluster) ?? 0) + 1);
  console.log(`  クラスタ分布: ${[...byCluster.entries()].map(([c, n]) => `${c}:${n}`).join(" / ")}`);

  // ② カバレッジ ───────────────────────────────
  console.log("\n── ② x_watch カバレッジ ──");
  const xItems = await prisma.item.findMany({
    where: { source: X_WATCH_SOURCE },
    select: { id: true, title: true, genre: true, marketPriceText: true },
  });
  const priced = await prisma.item.count({ where: { marketSource: X_MARKET_SOURCE } });
  const byGenre = new Map<string, number>();
  for (const it of xItems) byGenre.set(it.genre, (byGenre.get(it.genre) ?? 0) + 1);
  console.log(`  x_watch 新規商品: ${xItems.length}件（ジャンル: ${[...byGenre.entries()].map(([g, n]) => `${g}:${n}`).join(" / ") || "なし"}）`);
  console.log(`  X由来の相場(marketSource=x)付き: ${priced}件`);

  // ③ ソース被りの取りこぼし検出 ───────────────────────────────
  console.log("\n── ③ ソース被りの取りこぼし検出（x_watch↔他ソース） ──");
  let dupFound = 0;
  for (const it of xItems) {
    const tokens = distinctiveTokens(it.title);
    if (tokens.length === 0) continue;
    const candidates = await prisma.item.findMany({
      where: { AND: [{ source: { not: X_WATCH_SOURCE } }, { OR: tokens.map((t) => ({ title: { contains: t } })) }] },
      select: { id: true, title: true, source: true, marketSource: true },
      take: 600,
    });
    let best: { id: number; title: string; source: string; score: number } | null = null;
    for (const c of candidates) {
      const score = scoreMatch(it.title, c.title);
      if (!best || score > best.score) best = { id: c.id, title: c.title, source: c.source, score };
    }
    if (best && best.score >= DUP_THRESHOLD) {
      dupFound++;
      console.log(`  ⚠ x_watch #${it.id}「${it.title.slice(0, 34)}」`);
      console.log(`     ↔ #${best.id}[${best.source}]「${best.title.slice(0, 34)}」(類似${best.score.toFixed(2)})`);
      if (fix) {
        // 相場を既存側へ移し（既存が未取得のときだけ）、x_watch の重複カードを削除。
        const x = await prisma.item.findUnique({ where: { id: it.id }, select: { marketPrice: true, marketPriceText: true, marketUrl: true } });
        if (x?.marketPriceText) {
          await prisma.item.update({
            where: { id: best.id },
            data: { marketPrice: x.marketPrice, marketPriceText: x.marketPriceText, marketUrl: x.marketUrl, marketSource: X_MARKET_SOURCE, marketCheckedAt: nowInstant() },
          });
        }
        await prisma.item.delete({ where: { id: it.id } });
        console.log(`     → 統合: 相場を#${best.id}へ移し x_watch #${it.id} を削除`);
      }
    }
  }
  console.log(`  潜在重複: ${dupFound}件${dupFound && !fix ? "（--fix で統合）" : dupFound ? "（統合済み）" : " ✓"}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
