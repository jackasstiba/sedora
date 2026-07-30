import { prisma } from "./prisma";
import type { Prisma } from "@/generated/prisma/client";
import { todayJst } from "./date";
import { STATUS_EVENT_TYPES, TBD_EVENT_TYPES, type ItemStatus, type ItemWhen } from "./itemFilter";

// 絞り込みの純粋ロジック・定数・型は prisma 非依存の itemFilter.ts に集約し、
// クライアント側フィルタと共有する。ここではそれらを再エクスポートして使う。
export { STATUS_EVENT_TYPES, groupItemsByDate, sourceLabel } from "./itemFilter";
export type { ItemStatus, ItemWhen } from "./itemFilter";

export type ItemFilter = {
  genre?: string;
  source?: string;
  query?: string;
  sort?: "date" | "recent";
  status?: ItemStatus;
  when?: ItemWhen;
  datedOnly?: boolean;
};

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
  const today = todayJst(); // 日本時間の「今日」を暦日(UTC0時)で

  if (filter.status === "now") {
    // 速報ビューは日付なし（いま買える）に固定済みなので、日付条件は付けない
  } else if (filter.when) {
    // 今週／今月フィルタは日付が確定しているものだけ（未定は範囲に入らない）
    const end = new Date(today);
    if (filter.when === "week") {
      const dow = today.getUTCDay(); // 0=日
      const daysToNextMon = ((8 - dow) % 7) || 7;
      end.setUTCDate(today.getUTCDate() + daysToNextMon); // 来週月曜0時（＝今週末まで）
    } else {
      end.setUTCMonth(today.getUTCMonth() + 1, 1); // 翌月1日0時（＝今月末まで）
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
    // 表示スコープ（今後＋日付未定）の全件を返す。以前は 1000 で頭打ちになり、
    // 件数が 1000 を超えると日付未定分が末尾から欠落し「掲載 N件」と実データが
    // 食い違っていた（getStats は全件を数えるため）。余裕を持った上限にする。
    take: 5000,
  });
}

export async function getStats() {
  // 表示と同じスコープ（今後の予定＋日付未定）で件数を数える。過去に終わった
  // イベントは表示されないので「掲載 N件」にも含めない。
  const today = todayJst();
  const total = await prisma.item.count({
    where: { OR: [{ eventDate: { gte: today } }, { eventDate: null }] },
  });
  const latest = await prisma.item.findFirst({
    orderBy: { scrapedAt: "desc" },
    select: { scrapedAt: true },
  });
  return { total, lastUpdated: latest?.scrapedAt ?? null };
}
