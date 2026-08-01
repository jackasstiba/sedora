import { prisma } from "./prisma";
import { todayJst } from "./date";
import { dedupeItems } from "./itemFilter";
import { franchiseAliases, franchiseLabel } from "./franchise";

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

/**
 * 関連アイテムを2系統で返す（自分自身は除く）。
 * - series: タイトルから作品を判定し、同じ作品の予約/発売（ジャンル横断）。関連性が高い。
 * - genre:  同ジャンルの新着（作品で拾えない/枠が余った分の補完）。series と重複しない。
 */
export async function getRelatedItems(
  item: { id: number; genre: string; title: string },
  take = 12
) {
  const today = todayJst();
  const upcoming = { OR: [{ eventDate: { gte: today } }, { eventDate: null }] };
  const orderBy = [
    { eventDate: { sort: "asc" as const, nulls: "last" as const } },
    { id: "desc" as const },
  ];

  // 1) 同じ作品（ジャンル横断）。ワンピのフィギュアとカードを互いに関連づける等。
  const aliases = franchiseAliases(item.title);
  const series = aliases.length
    ? await prisma.item.findMany({
        where: {
          id: { not: item.id },
          AND: [{ OR: aliases.map((a) => ({ title: { contains: a } })) }, upcoming],
        },
        orderBy,
        take,
      })
    : [];

  // 2) 同ジャンルで補完（series と自分自身は除外）。
  const excludeIds = [item.id, ...series.map((s) => s.id)];
  const need = take - series.length;
  const genre =
    need > 0
      ? await prisma.item.findMany({
          where: { genre: item.genre, id: { notIn: excludeIds }, ...upcoming },
          orderBy,
          take: need,
        })
      : [];

  return { seriesLabel: franchiseLabel(item.title), series, genre };
}

/** ジャンルページ用：今後の予定＋日付未定を発売日順で。
 *  take はジャンル最大件数（フィギュアは400件超）を賄えるだけ確保する。
 *  以前は 200 で頭打ちになり、フィギュアで約200件が欠落し見出しの件数も過少だった。 */
export async function getItemsByGenre(genre: string, take = 1500) {
  const today = todayJst();
  const rows = await prisma.item.findMany({
    where: { genre, OR: [{ eventDate: { gte: today } }, { eventDate: null }] },
    orderBy: [{ eventDate: { sort: "asc", nulls: "last" } }, { id: "desc" }],
    take,
  });
  // ジャンルページの一覧・見出し件数（items.length）から重複を除く。
  return dedupeItems(rows);
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

/** サイトマップ／内部リンク用：アイテムを持つ月（yyyy-mm）の一覧を新しい順で。
 *  当月以降のみ返す。過去月の /release ページは期限切れ発売予定の“死にページ”で、
 *  サイトマップに載せるとクロール割当を薄め、内部リンクとしても価値がないため除外する
 *  （getSitemapItemRefs が過去アイテムを除外しているのと同じ方針で整合させる）。 */
export async function getMonthsWithItems(): Promise<string[]> {
  const rows = await prisma.item.findMany({
    where: { eventDate: { not: null } },
    select: { eventDate: true },
  });
  const now = todayJst();
  const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const set = new Set<string>();
  for (const r of rows) {
    if (!r.eventDate) continue;
    const d = new Date(r.eventDate);
    const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    if (month < currentMonth) continue; // 過去月は除外（当月は途中でも残す）
    set.add(month);
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

/** サイトマップ用：クロール価値のあるアイテムの id と更新日時。
 *  一覧に出る「今後の予定＋日付未定」に加え、直近に終了した分（60日）まで含める。
 *  ずっと過去の終了イベントは実質“死にページ”で、全件出すとクロール割当を薄め
 *  ランク付けを妨げるため除外する（サイトの表示スコープとも整合させる）。
 *  ※ 過去アイテムの個別ページ自体は 200 で残るので、除外しても 404 は生じない。 */
export async function getSitemapItemRefs() {
  const today = todayJst();
  const grace = new Date(today);
  grace.setUTCDate(grace.getUTCDate() - 60); // 直近60日で終了した分は残す
  return prisma.item.findMany({
    where: { OR: [{ eventDate: { gte: grace } }, { eventDate: null }] },
    select: { id: true, scrapedAt: true },
  });
}
