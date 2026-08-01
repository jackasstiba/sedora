import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "../src/lib/prisma";
import {
  X_WATCH_SOURCE,
  buildMarketFields,
  formatResaleText,
  pickBestMatch,
  similarity,
  toScrapedItem,
  type XWatchInbox,
} from "../src/lib/xWatch";

// X巡回（Claude for Chrome）で構造化した受け皿JSONをレアレーダーDBに取り込む。
// 使い方: npm run ingest:x [-- --file scripts/x_watch/x_watch_inbox.json] [--dry]
//   kind:"new"    → source=x_watch の新規商品として upsert（相場は market* に載る）
//   kind:"resale" → 既存アイテムに実売相場を付与（itemId 明示 or match で曖昧一致）
// --dry を付けるとDBに書かず、何が入るか（新規/相場付与/マッチ失敗）だけを表示する。

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

const DEFAULT_FILE = "scripts/x_watch/x_watch_inbox.json";

async function main() {
  const dry = hasFlag("dry");
  const file = resolve(process.cwd(), arg("file") ?? DEFAULT_FILE);
  if (!existsSync(file)) {
    console.error(`[x] 受け皿JSONが見つかりません: ${file}`);
    console.error(`   scripts/x_watch/x_watch_inbox.example.json を複製して巡回結果を書いてください。`);
    process.exit(1);
  }

  const inbox = JSON.parse(readFileSync(file, "utf8")) as XWatchInbox;
  const entries = inbox.entries ?? [];
  console.log(`[x] ${entries.length}件 読み込み${dry ? "（DRY RUN・DB書き込みなし）" : ""} <- ${file}`);

  const now = new Date();
  let added = 0;
  let priced = 0;
  let missed = 0;
  const misses: string[] = [];

  for (const entry of entries) {
    if (entry.kind === "new") {
      const item = toScrapedItem(entry, now);
      if (!item.title || !item.url) {
        missed++;
        misses.push(`new: title/url 不足 (${entry.title ?? entry.url ?? "?"})`);
        continue;
      }
      const resale = formatResaleText(entry);
      console.log(`  + [新規] ${item.genre} / ${item.eventType} / ${item.title.slice(0, 44)}${resale ? `  相場:${resale}` : ""}`);
      if (!dry) {
        await prisma.item.upsert({
          where: { source_sourceId: { source: X_WATCH_SOURCE, sourceId: item.sourceId } },
          create: item,
          update: {
            title: item.title,
            genre: item.genre,
            subGenre: item.subGenre,
            eventType: item.eventType,
            eventDate: item.eventDate,
            eventDateText: item.eventDateText,
            price: item.price,
            url: item.url,
            imageUrl: item.imageUrl,
            hasLottery: item.hasLottery,
            marketPrice: item.marketPrice,
            marketPriceText: item.marketPriceText,
            marketUrl: item.marketUrl,
            marketSource: item.marketSource,
            marketCheckedAt: item.marketCheckedAt,
            scrapedAt: now,
          },
        });
      }
      added++;
    } else if (entry.kind === "resale") {
      const market = buildMarketFields(entry, now);
      if (!market.marketPrice && !market.marketPriceText) {
        missed++;
        misses.push(`resale: 相場(resaleYen/resaleText)が空 (${entry.match ?? entry.itemId ?? "?"})`);
        continue;
      }

      let target: { id: number; title: string } | null = null;
      if (entry.itemId) {
        const found = await prisma.item.findUnique({ where: { id: entry.itemId }, select: { id: true, title: true } });
        if (found) target = found;
      }
      let near: { id: number; title: string; score: number } | null = null;
      if (!target && entry.match) {
        // 曖昧マッチ: 候補を絞るため match の主要トークンで前段フィルタしてから Dice 係数で最良を選ぶ。
        const token = entry.match.replace(/[\s　].*/, "").slice(0, 6);
        const candidates = await prisma.item.findMany({
          where: { title: { contains: token } },
          select: { id: true, title: true },
          take: 400,
        });
        const best = pickBestMatch(entry.match, candidates);
        if (best) target = { id: best.id, title: best.title };
        else if (candidates.length) {
          // 閾値未満でも最有力の惜しい候補を出す（Xの略称は2-gramで低スコアになりがち。
          // 巡回中にこれを見て itemId 直指定へ切り替えられるように）。
          const scored = candidates
            .map((c) => ({ id: c.id, title: c.title, score: similarity(entry.match!, c.title) }))
            .sort((a, b) => b.score - a.score)[0];
          near = scored ?? null;
        }
      }

      if (!target) {
        missed++;
        const hint = near
          ? `惜しい候補 #${near.id}「${near.title.slice(0, 30)}」(類似${near.score.toFixed(2)}) → itemId 直指定を検討`
          : `新規化を検討`;
        misses.push(`resale: 既存未一致 (${entry.match ?? entry.itemId}) — ${hint}`);
        continue;
      }

      console.log(`  ~ [相場] #${target.id} ${target.title.slice(0, 40)}  ← ${market.marketPriceText}`);
      if (!dry) {
        await prisma.item.update({ where: { id: target.id }, data: market });
      }
      priced++;
    } else {
      missed++;
      misses.push(`不明な kind: ${JSON.stringify(entry).slice(0, 60)}`);
    }
  }

  console.log(`\n[x] 完了: 新規 ${added} / 相場付与 ${priced} / 取りこぼし ${missed}`);
  if (misses.length) {
    console.log(`   取りこぼし詳細:`);
    for (const m of misses) console.log(`     - ${m}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
