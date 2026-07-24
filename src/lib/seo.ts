import { prisma } from "./prisma";
import { todayJst } from "./date";

// SEO向けの個別ページ（商品/ジャンル/月）で使うデータ取得・整形ヘルパー。

const GENRE_ORDER = [
  "フィギュア",
  "トレカ",
  "スニーカー",
  "プラモ",
  "一番くじ",
  "コラボ",
  "ポケモン",
];

export type SeoItem = Awaited<ReturnType<typeof getItemById>>;

export async function getItemById(id: number) {
  if (!Number.isFinite(id)) return null;
  return prisma.item.findUnique({ where: { id } });
}

/** 同じジャンルの、これから予約・発売の関連アイテム（自分自身は除く） */
export async function getRelatedItems(genre: string, excludeId: number, take = 12) {
  const today = todayJst();
  return prisma.item.findMany({
    where: {
      genre,
      id: { not: excludeId },
      OR: [{ eventDate: { gte: today } }, { eventDate: null }],
    },
    orderBy: [{ eventDate: { sort: "asc", nulls: "last" } }, { id: "desc" }],
    take,
  });
}

/** ジャンルページ用：今後の予定＋日付未定を発売日順で */
export async function getItemsByGenre(genre: string, take = 200) {
  const today = todayJst();
  return prisma.item.findMany({
    where: { genre, OR: [{ eventDate: { gte: today } }, { eventDate: null }] },
    orderBy: [{ eventDate: { sort: "asc", nulls: "last" } }, { id: "desc" }],
    take,
  });
}

/** "2026-08" -> その月の [開始, 翌月開始) */
function monthRange(month: string): { start: Date; end: Date } | null {
  const m = month.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  // 暦日は UTC 0時基準（保存値と揃える）
  return { start: new Date(Date.UTC(y, mo - 1, 1)), end: new Date(Date.UTC(y, mo, 1)) };
}

/** 月ページ用：その月に発売・開催のアイテム（過去も含めた一覧） */
export async function getItemsByMonth(month: string, take = 300) {
  const range = monthRange(month);
  if (!range) return [];
  return prisma.item.findMany({
    where: { eventDate: { gte: range.start, lt: range.end } },
    orderBy: [{ eventDate: "asc" }, { id: "desc" }],
    take,
  });
}

export function isValidMonth(month: string): boolean {
  return monthRange(month) !== null;
}

/** "2026-08" -> "2026年8月" */
export function monthLabel(month: string): string {
  const m = month.match(/^(\d{4})-(\d{2})$/);
  if (!m) return month;
  return `${m[1]}年${Number(m[2])}月`;
}

/** サイトマップ／内部リンク用：アイテムを持つ月（yyyy-mm）の一覧を新しい順で */
export async function getMonthsWithItems(): Promise<string[]> {
  const rows = await prisma.item.findMany({
    where: { eventDate: { not: null } },
    select: { eventDate: true },
  });
  const set = new Set<string>();
  for (const r of rows) {
    if (!r.eventDate) continue;
    const d = new Date(r.eventDate);
    set.add(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return [...set].sort().reverse();
}

/** 内部リンク用：ジャンル一覧（表示順を固定、未知ジャンルは末尾） */
export async function getGenreList(): Promise<string[]> {
  const rows = await prisma.item.groupBy({ by: ["genre"], _count: true });
  const genres = rows.map((r) => r.genre);
  return genres.sort((a, b) => {
    const ia = GENRE_ORDER.indexOf(a);
    const ib = GENRE_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
}

/** サイトマップ用：全アイテムの id と更新日時 */
export async function getAllItemRefs() {
  return prisma.item.findMany({ select: { id: true, scrapedAt: true } });
}
