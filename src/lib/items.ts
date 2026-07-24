import { prisma } from "./prisma";
import type { Prisma } from "@/generated/prisma/client";

export type ItemStatus = "reserve" | "lottery" | "release" | "now";
export type ItemWhen = "week" | "month";

export type ItemFilter = {
  genre?: string;
  source?: string;
  query?: string;
  sort?: "date" | "recent";
  status?: ItemStatus;
  when?: ItemWhen;
  datedOnly?: boolean;
};

// 日付なしのうち「日程未定の予定品」を表す eventType（＝いま買えるわけではない）。
const TBD_EVENT_TYPES = ["登場予定", "開催"];

// バラバラな eventType 文字列を、せどり視点の3グループに正規化する。
export const STATUS_EVENT_TYPES: Record<Exclude<ItemStatus, "now">, string[]> = {
  reserve: ["予約開始", "予約受付中", "受付開始"],
  lottery: ["抽選"],
  release: ["発売", "販売開始", "登場予定", "開催", "再販"],
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
  pokemoncard: "ポケモンカード公式",
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
  const where: Prisma.ItemWhereInput = {};
  const and: Prisma.ItemWhereInput[] = []; // OR グループを複数持つため AND で束ねる
  if (filter.genre) where.genre = filter.genre;
  if (filter.source) where.source = filter.source;
  if (filter.query) where.title = { contains: filter.query };

  if (filter.status === "now") {
    // 「いま買える」速報。Xミラー系(あみあみ予約開始/販売再開など)は未来の日付が無く、
    // 日付なし＝今すぐ動くべき情報。せどり的に価値が高いので専用ビューで拾う。
    // ただし「登場予定」「開催」は“日程未定の予定品”なので速報からは外す。
    where.eventDate = null;
    where.eventType = { notIn: TBD_EVENT_TYPES };
  } else if (filter.status === "lottery") {
    // 抽選は eventType が「抽選」のものに加え、タイトルに「抽選」を含むものも拾う
    // （例: eventType=登場予定 だが「抽選販売」の商品）。せどり的に取りこぼさない。
    and.push({ OR: [{ eventType: "抽選" }, { title: { contains: "抽選" } }] });
  } else if (filter.status === "reserve" || filter.status === "release") {
    where.eventType = { in: STATUS_EVENT_TYPES[filter.status] };
  }

  // 過去に終わったイベントは常に除外し、これから予約・発売される商品（＋日付未定）
  // だけを表示する。新着順でも過去イベント（例: 後から収集した3月開催分）を出さない。
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (filter.status === "now") {
    // 速報ビューは日付なし（いま買える）に固定済みなので、日付条件は付けない
  } else if (filter.when) {
    // 今週／今月フィルタは日付が確定しているものだけ（未定は範囲に入らない）
    const end = new Date(today);
    if (filter.when === "week") {
      const dow = today.getDay(); // 0=日
      const daysToNextMon = ((8 - dow) % 7) || 7;
      end.setDate(today.getDate() + daysToNextMon); // 来週月曜0時（＝今週末まで）
    } else {
      end.setMonth(today.getMonth() + 1, 1); // 翌月1日0時（＝今月末まで）
    }
    where.eventDate = { gte: today, lt: end };
  } else if (filter.datedOnly) {
    where.eventDate = { gte: today }; // 日付が確定しているものだけ（未定を隠す）
  } else {
    and.push({ OR: [{ eventDate: { gte: today } }, { eventDate: null }] });
  }

  if (and.length) where.AND = and;

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

/** 発売日順のアイテムを「今日/明日/今週/それ以降/日付未定」に分けて見出し表示しやすくする */
export function groupItemsByDate<T extends { eventDate: Date | null }>(
  items: T[]
): { label: string; items: T[] }[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const t0 = today.getTime();
  const day = 24 * 60 * 60 * 1000;
  const tomorrow = t0 + day;
  const dayAfter = t0 + 2 * day;
  const dow = today.getDay();
  const nextMon = t0 + (((8 - dow) % 7) || 7) * day;

  const buckets: Record<string, T[]> = {
    今日: [],
    明日: [],
    今週: [],
    それ以降: [],
    日付未定: [],
  };
  for (const it of items) {
    if (!it.eventDate) {
      buckets["日付未定"].push(it);
      continue;
    }
    const d = new Date(it.eventDate);
    d.setHours(0, 0, 0, 0);
    const ms = d.getTime();
    if (ms < tomorrow) buckets["今日"].push(it);
    else if (ms < dayAfter) buckets["明日"].push(it);
    else if (ms < nextMon) buckets["今週"].push(it);
    else buckets["それ以降"].push(it);
  }
  return Object.entries(buckets)
    .filter(([, arr]) => arr.length > 0)
    .map(([label, arr]) => ({ label, items: arr }));
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
