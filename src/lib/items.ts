import { prisma } from "./prisma";

export type ItemFilter = {
  genre?: string;
  source?: string;
  query?: string;
  sort?: "date" | "recent";
};

const SOURCE_LABELS: Record<string, string> = {
  figisland: "フィギュアーランド",
  figisland_pb: "プレミアムバンダイ",
  koretore: "コレトレ!!",
  torecamap: "トレカの地図",
  snkrdunk: "スニーカーダンク",
  rarecheck: "レアチェック",
  channeltono: "ちゃんねらー速報",
  collabo_cafe: "コラボカフェ",
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

export async function getGenres(): Promise<{ genre: string; count: number }[]> {
  const rows = await prisma.item.groupBy({
    by: ["genre"],
    _count: true,
    orderBy: { _count: { genre: "desc" } },
  });
  return rows.map((r) => ({ genre: r.genre, count: r._count }));
}

export async function getSources(): Promise<{ source: string; count: number }[]> {
  const rows = await prisma.item.groupBy({
    by: ["source"],
    _count: true,
    orderBy: { _count: { source: "desc" } },
  });
  return rows.map((r) => ({ source: r.source, count: r._count }));
}

export async function getItems(filter: ItemFilter) {
  const where: {
    genre?: string;
    source?: string;
    title?: { contains: string };
    OR?: Array<{ eventDate: { gte: Date } } | { eventDate: null }>;
  } = {};
  if (filter.genre) where.genre = filter.genre;
  if (filter.source) where.source = filter.source;
  if (filter.query) where.title = { contains: filter.query };

  // 発売・予約日順のときは、過去に終わったイベントは除外し、
  // これから予約・発売される商品（＋日付未定）だけを表示する。
  if (filter.sort !== "recent") {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    where.OR = [{ eventDate: { gte: today } }, { eventDate: null }];
  }

  const orderBy =
    filter.sort === "recent"
      ? ([{ scrapedAt: "desc" }] as const)
      : ([{ eventDate: { sort: "asc", nulls: "last" } }, { scrapedAt: "desc" }] as const);

  return prisma.item.findMany({
    where,
    orderBy: [...orderBy],
    take: 300,
  });
}

export async function getStats() {
  const total = await prisma.item.count();
  const latest = await prisma.item.findFirst({
    orderBy: { scrapedAt: "desc" },
    select: { scrapedAt: true },
  });
  return { total, lastUpdated: latest?.scrapedAt ?? null };
}
