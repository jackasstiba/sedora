import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "../src/lib/prisma";
import {
  X_WATCH_SOURCE,
  buildMarketFields,
  distinctiveTokens,
  formatResaleText,
  scoreMatch,
  toScrapedItem,
  type XWatchInbox,
} from "../src/lib/xWatch";
import { nowInstant } from "../src/lib/date";

// X巡回（Claude for Chrome）で構造化した受け皿JSONをハツコレDBに取り込む。
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

/**
 * 特徴トークン（型番＋作品名＋最長内容語）のいずれかを含む既存アイテムを候補として引く。
 * 先頭数文字だけの脆い前段フィルタと違い、Xの略称・語順違い・告知文ノイズがあっても
 * 同一商品を候補に載せられる（＝取りこぼしによる重複発生を防ぐ）。
 */
async function gatherCandidates(
  text: string,
  opts: { excludeSource?: string } = {}
): Promise<{ id: number; title: string }[]> {
  const tokens = distinctiveTokens(text);
  if (tokens.length === 0) tokens.push(text.replace(/[\s　].*/, "").slice(0, 6));
  const where: Record<string, unknown> = { OR: tokens.map((t) => ({ title: { contains: t } })) };
  if (opts.excludeSource) where.source = { not: opts.excludeSource };
  return prisma.item.findMany({ where, select: { id: true, title: true }, take: 600 });
}

/** 候補の中で scoreMatch 最良の1件（しきい値未満でも返す。しきい値判定は呼び出し側）。 */
function topScored(
  text: string,
  candidates: { id: number; title: string }[]
): { id: number; title: string; score: number } | null {
  let best: { id: number; title: string; score: number } | null = null;
  for (const c of candidates) {
    const score = scoreMatch(text, c.title);
    if (!best || score > best.score) best = { id: c.id, title: c.title, score };
  }
  return best;
}

const MATCH_THRESHOLD = 0.5;

/** text に一致する既存アイテムを1件返す（scoreMatch がしきい値以上のときだけ）。 */
async function fuzzyFindItem(
  text: string,
  opts: { excludeSource?: string } = {}
): Promise<{ id: number; title: string; score: number } | null> {
  const best = topScored(text, await gatherCandidates(text, opts));
  return best && best.score >= MATCH_THRESHOLD ? best : null;
}

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

  const now = nowInstant();
  let added = 0;
  let merged = 0;
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

      // 【重複防止】スクレイピング既存ソースが同じ商品を既に載せているなら、x_watch で
      // 新規カードを作らず、その既存商品に相場だけ付与する（＝ソース被りで一覧に同じ商品が
      // 2枚出るのを発生源で防ぐ）。x_watch 自身は除外（再巡回は下の upsert が sourceId で冪等）。
      const dup = await fuzzyFindItem(item.title, { excludeSource: X_WATCH_SOURCE });
      if (dup) {
        const market = buildMarketFields(entry, now);
        console.log(`  = [統合] #${dup.id} ${dup.title.slice(0, 40)}  ← ${market.marketPriceText ?? "(相場なし)"}（既存に付与・新規化せず / 類似${dup.score.toFixed(2)}）`);
        if (!dry && market.marketPriceText) {
          await prisma.item.update({ where: { id: dup.id }, data: market });
        }
        merged++;
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
        // 特徴トークン（型番＋作品名＋内容語）で候補を引き、scoreMatch 最良を選ぶ。
        const candidates = await gatherCandidates(entry.match);
        const best = topScored(entry.match, candidates);
        if (best && best.score >= MATCH_THRESHOLD) target = { id: best.id, title: best.title };
        else near = best; // しきい値未満でも最有力の惜しい候補を出す（itemId直指定の手掛かり）
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

  console.log(`\n[x] 完了: 新規 ${added} / 既存へ統合 ${merged} / 相場付与 ${priced} / 取りこぼし ${missed}`);
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
