// `/en/trends`＝「日本の公式ストアが**今週なにを並べたか**」（2026-08-23 新設）。
//
// 狙い: 英語圏の読者は多くの場合そもそも買えない（/en 自身が「多くは国内発送のみ・代行が普通」と
// 断っている）。英語面で一番強い価値は「買え」ではなく「**日本で今なにが起きているかを先に知れる**」側。
// 一覧は検索で拾われてもシェアされないが、こちらは貼られる側になる。
//
// **なぜ storeListedAt で作るのか（推測を1つも混ぜないため）**:
//  ・`Item.id` の順は「こちらが初めて見た順」でしかない。巡回を止めていた期間があると、
//    4日ぶんが1日に押し込まれて「その日に大量に出た」ように見える（実際 2026-08-18〜22 に停止していた）。
//  ・`scrapedAt` は巡回のたび上書きされる＝日付ではない。
//  ・`storeListedAt` は**店自身が付けた公開日**（Shopify の published_at）。こちらの都合と無関係に
//    正しいので、「この日に店に並んだ」とだけ言い切れる。持っていない行は**この面に出さない**
//    （日付を推定して埋めない＝[[既定値に語らせない]]）。
//
// **窓の終わりを「今日」にしない**: 巡回が止まれば新しい行は入らないのに、窓だけが今日まで伸びると
// 「今週は2件でした」という**空白を事実として語る**ことになる。窓の終わりは必ず
// 「**最後にその店を見た時刻**」＝観測の端にする（trendWindow）。止まっていれば窓ごと過去にずれ、
// 画面には「as of ◯月◯日」と出る。
//
// **店名を出してよい根拠**: ここに出るのは EN_CATALOG_STORES＝`OFFICIAL_URL_SOURCES` に入る
// 公式ストアだけ（src/lib/enCatalog.ts）。まとめ記事・アグリゲータは**絶対に混ぜない**
// （混ぜた瞬間に収集元が割れる）。母集団を登録簿から導出しているので、店を足しても書き漏れない。
import { prisma } from "./prisma";
import { EN_CATALOG_STORES, EN_TRENDS_PATH, type EnCatalogStore } from "./enCatalog";

// ページ名は登録簿（enCatalog.ts）が持つ。理由はあちらのコメント（scope.ts に prisma を
// 持ち込まないため）。ここからも読めるように通す＝呼ぶ側は import 先を悩まない。
export { EN_TRENDS_PATH };

/** 「今週」の長さ。7日固定＝読者が数えられる単位にする（30日は「今」ではない）。 */
export const TRENDS_WINDOW_DAYS = 7;

/** この面に出してよい収集元（＝店名を出してよい公式ストアだけ）。 */
export function trendsSources(): string[] {
  return EN_CATALOG_STORES.map((s) => s.source);
}

export type TrendWindow = { from: Date; to: Date };

/**
 * 集計の窓。**終わりは観測の端**（最後にその店を見た時刻）で、今日ではない。
 *
 * @param lastCheckedAt その店たちを最後に見た時刻（= max(scrapedAt)）。null＝一度も見ていない
 * @returns null＝窓を作れない（＝この面は何も言わない。0件と言わない）
 */
export function trendWindow(lastCheckedAt: Date | null, days = TRENDS_WINDOW_DAYS): TrendWindow | null {
  if (!lastCheckedAt) return null;
  const to = new Date(lastCheckedAt);
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { from, to };
}

/** 観測の端。**この面が「いつ時点の話か」を決める唯一の値。** */
export async function getTrendsLastCheckedAt(): Promise<Date | null> {
  const row = await prisma.item.findFirst({
    where: { source: { in: trendsSources() } },
    orderBy: { scrapedAt: "desc" },
    select: { scrapedAt: true },
  });
  return row?.scrapedAt ?? null;
}

/** 窓の中で公式ストアに並んだ行（新しい順）。storeListedAt を持たない行は入らない。 */
export async function getTrendItems(w: TrendWindow) {
  return prisma.item.findMany({
    where: {
      source: { in: trendsSources() },
      storeListedAt: { gte: w.from, lte: w.to },
    },
    orderBy: [{ storeListedAt: "desc" }, { id: "desc" }],
    take: 500,
  });
}

export type StoreCount = { store: EnCatalogStore; count: number };

/**
 * 店ごとの件数（多い順）。**0件の店は返さない**＝「無い」と「見ていない」を混ぜない。
 * 純関数（DBも時計も読まない）＝ audit:selftest が数え方を固定する。
 */
export function countByStore(rows: { source: string }[]): StoreCount[] {
  const n = new Map<string, number>();
  for (const r of rows) n.set(r.source, (n.get(r.source) ?? 0) + 1);
  return EN_CATALOG_STORES.filter((s) => (n.get(s.source) ?? 0) > 0)
    .map((store) => ({ store, count: n.get(store.source)! }))
    .sort((a, b) => b.count - a.count || a.store.name.localeCompare(b.store.name));
}

/**
 * 見出しに出してよい1行を作る。**この面が約束するのはここに書いてあることだけ。**
 *
 * 「新発売」「入手困難」「人気」とは書かない（どれも裏が取れない）。言えるのは
 * 「その店のサイトに、この期間に**並んだ**」という店自身の記録だけ。
 */
export function trendsHeadlineEn(count: number, stores: number): string {
  const item = count === 1 ? "item" : "items";
  const store = stores === 1 ? "store" : "stores";
  return `${count} ${item} went up across ${stores} official Japanese ${store}`;
}

/**
 * 観測が古いか（＝画面で「最新ではない」と断る必要があるか）。
 *
 * 巡回は毎朝1回で、PCが起動していない朝は流れない（[[巡回は朝1回だけ]]）。止まっている間も
 * ページは配信され続けるので、**黙って古い数字を今週の話として出さない**ための判定。
 * 2日以上空いたら断る（1日は平常運転＝毎朝の巡回前は必ず前日になる）。
 */
export function trendsIsStale(w: TrendWindow, now: Date, staleDays = 2): boolean {
  return now.getTime() - w.to.getTime() >= staleDays * 24 * 60 * 60 * 1000;
}
