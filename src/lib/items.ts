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
  ichiban_kuji: "一番くじ倶楽部",
  pokemon_goods: "ポケモン公式",
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

  // 過去に終わったイベントは常に除外し、これから予約・発売される商品（＋日付未定）
  // だけを表示する。新着順でも過去イベント（例: 後から収集した3月開催分）を出さない。
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  where.OR = [{ eventDate: { gte: today } }, { eventDate: null }];

  // 新着順は id 降順（＝DB登録順＝初回発見順）。scrapedAt は毎回のスクレイプで全件
  // 更新されてしまい「新着」の基準にならないため使わない。
  const orderBy =
    filter.sort === "recent"
      ? ([{ id: "desc" }] as const)
      : ([{ eventDate: { sort: "asc", nulls: "last" } }, { id: "desc" }] as const);

  return prisma.item.findMany({
    where,
    orderBy: [...orderBy],
    take: 1000,
  });
}

export async function getStats() {
  // 表示と同じスコープ（今後の予定＋日付未定）で件数を数える。過去に終わった
  // イベントは表示されないので「掲載 N件」にも含めない。
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const total = await prisma.item.count({
    where: { OR: [{ eventDate: { gte: today } }, { eventDate: null }] },
  });
  const latest = await prisma.item.findFirst({
    orderBy: { scrapedAt: "desc" },
    select: { scrapedAt: true },
  });
  return { total, lastUpdated: latest?.scrapedAt ?? null };
}
