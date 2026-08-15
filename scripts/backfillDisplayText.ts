/**
 * 「保存済みの表示文字列」の修復（scrape.ts の定常経路から毎回呼ぶ）。
 *
 * ここが要る理由は毎回同じ形をしている＝**一度DBに入った表示文字列は、その行が巡回窓から
 * 外れた瞬間に永久に固定される**（収集元の記事が流れる／同じ sourceId が返ってこなくなる）。
 * スクレイパー側を直しても既存行は直らないので、直し方を「次の巡回で自然に上書き」に
 * 頼ってはいけない（ミス13・8/15の画像バックフィルと同型）。
 *
 * 扱うのは2つ。どちらも**画面に出る文字列そのもの**が対象。
 *  (1) 相対日付の凍結解除 … 「〜明日 22:00」を巡回時刻から暦日に解決して絶対表記に戻す。
 *  (2) 月精度の取りこぼし … タイトルが「12月発売」と言っているのに日付欄が「日付未定」の行。
 */
import type { PrismaClient } from "../src/generated/prisma/client";
import { prisma } from "../src/lib/prisma";
import { monthPrecisionFromTitle, todayJst } from "../src/lib/date";
import { parseStoresJson, summarizeStores, type StoreEntry } from "../src/lib/stores";
import { resolveMonthDay } from "../src/scrapers/util";

/** 保存済みの受付時刻ラベルを、絶対表記＋暦日(at)に直す（純関数・selftest対象）。 */
export function unfreezeStoreWhen(
  when: string | null,
  kindHint: "締切" | "開始" | null,
  scrapedAt: Date
): { when: string | null; at: string | null; kind: "締切" | "開始" | null } {
  if (!when) return { when: null, at: null, kind: kindHint };
  // 巡回時刻(UTC実時刻)を日本時間の暦日に落とす＝収集元が「本日」と書いた日。
  const jst = new Date(scrapedAt.getTime() + 9 * 3600_000);
  const base = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()));
  const kind: "締切" | "開始" | null = kindHint ?? (when.startsWith("〜") ? "締切" : when.endsWith("〜") ? "開始" : null);

  let date: Date | null = null;
  if (/本日/.test(when)) date = base;
  else if (/明日/.test(when)) date = new Date(base.getTime() + 86_400_000);
  else {
    const md = when.match(/(\d{1,2})\/(\d{1,2})/);
    if (md) date = resolveMonthDay(Number(md[1]), Number(md[2]), base);
  }
  if (!date) return { when, at: null, kind };
  const abs = `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
  return {
    when: when.replace(/本日|明日|\d{1,2}\/\d{1,2}/, abs),
    at: date.toISOString().slice(0, 10),
    kind,
  };
}

/** (1) 保存済みの相対日付を絶対表記に戻し、at/kind を埋める。 */
async function unfreezeRelativeStoreLabels(db: PrismaClient): Promise<number> {
  const rows = await db.item.findMany({
    where: { stores: { not: null } },
    select: { id: true, stores: true, highlights: true, scrapedAt: true },
  });
  let fixed = 0;
  for (const r of rows) {
    const stores = parseStoresJson(r.stores);
    if (!stores) continue;
    const next: StoreEntry[] = stores.map((s) => {
      const u = unfreezeStoreWhen(s.when, s.kind ?? null, r.scrapedAt);
      return { ...s, when: u.when, at: s.at ?? u.at, kind: s.kind ?? u.kind };
    });
    const json = JSON.stringify(next);
    if (json === r.stores) continue;
    // カード面の要約（highlights）も同じ文字列から作られているので一緒に作り直す。
    // 作り直すのは「この要約でできている」と分かる形のものだけ（他の文言は触らない）。
    const highlights =
      r.highlights && r.highlights.startsWith("受付中ストア：")
        ? `受付中ストア：${summarizeStores(next, 3)}`
        : r.highlights;
    await db.item.update({ where: { id: r.id }, data: { stores: json, highlights } });
    fixed++;
  }
  return fixed;
}

/** (2) タイトルに月が書いてあるのに日付欄が空の行へ、月精度の予定テキストを入れる。 */
async function fillMonthPrecisionFromTitles(db: PrismaClient): Promise<number> {
  const today = todayJst();
  const rows = await db.item.findMany({
    where: { eventDate: null, OR: [{ eventDateText: null }, { eventDateText: "" }] },
    select: { id: true, title: true },
  });
  let filled = 0;
  for (const r of rows) {
    const text = monthPrecisionFromTitle(r.title, today);
    if (!text) continue;
    await db.item.update({ where: { id: r.id }, data: { eventDateText: text } });
    filled++;
  }
  return filled;
}

export async function backfillDisplayText(db: PrismaClient): Promise<void> {
  const unfrozen = await unfreezeRelativeStoreLabels(db);
  const filled = await fillMonthPrecisionFromTitles(db);
  console.log(`[表示文字列の修復] 相対日付の凍結解除 ${unfrozen}件 / 月精度の補完 ${filled}件`);
}

// 単体実行（`node --env-file-if-exists=.env --import tsx scripts/backfillDisplayText.ts`）
if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/backfillDisplayText.ts")) {
  backfillDisplayText(prisma).finally(() => prisma.$disconnect());
}
