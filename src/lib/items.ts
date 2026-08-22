import { prisma } from "./prisma";
import type { Prisma } from "@/generated/prisma/client";
import { todayJst } from "./date";
import { EN_ONLY_SCOPE, JP_SCOPE_WHERE } from "./scope";
import { STATUS_EVENT_TYPES, TBD_EVENT_TYPES, dedupeItems, sortByEventDate, type ItemStatus, type ItemWhen } from "./itemFilter";

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
    where: JP_SCOPE_WHERE, // EN専用行を数えない（ジャンルの件数はJP面の顔）
    _count: true,
    orderBy: { _count: { genre: "desc" } },
  });
  return rows.map((r) => ({ genre: r.genre, count: r._count }));
}

export async function getSources(): Promise<{ source: string; count: number }[]> {
  const rows = await prisma.item.groupBy({
    by: ["source"],
    where: JP_SCOPE_WHERE,
    _count: true,
    orderBy: { _count: { source: "desc" } },
  });
  return rows.map((r) => ({ source: r.source, count: r._count }));
}

export async function getItems(filter: ItemFilter) {
  const where: Prisma.ItemWhereInput = {};
  // OR グループを複数持つため AND で束ねる。EN専用行（scope="en"）はJP面に出さない。
  const and: Prisma.ItemWhereInput[] = [JP_SCOPE_WHERE];
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
    // ただし snkrdunk は全商品のタイトル末尾に「｜抽選/販売/定価情報」という定型ラベルが
    // 付くため、タイトル推定からは除外する（通常発売品の誤混入を防ぐ）。クライアント側の
    // isLotteryItem と同じ意味論。真のスニーカー抽選は nike_snkrs(eventType=抽選)で拾う。
    and.push({
      OR: [
        { eventType: "抽選" },
        { hasLottery: true }, // コラボ記事本文から抽選/ランダム賞品を検出したイベント
        { AND: [{ title: { contains: "抽選" } }, { source: { not: "snkrdunk" } }] },
      ],
    });
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

  const rows = await prisma.item.findMany({
    where,
    orderBy: [...orderBy],
    // 表示スコープ（今後＋日付未定）の全件を返す。以前は 1000 で頭打ちになり、
    // 件数が 1000 を超えると日付未定分が末尾から欠落し「掲載 N件」と実データが
    // 食い違っていた（getStats は全件を数えるため）。余裕を持った上限にする。
    take: 5000,
  });
  // 複数ソースが同じ商品を載せる重複表示を解消（figisland↔koretore／Nike SNKRS↔snkrdunk）。
  const deduped = dedupeItems(rows);
  // 日付順の面だけ並べ直す。応募先を持つ商品の表示日は dedupeItems の中で today 基準に
  // 作り直されるので、SQL の並びはその行だけ古い。新着順(RSS)はここを通さない。
  return filter.sort === "recent" ? deduped : sortByEventDate(deduped);
}

/**
 * EN専用カタログ（`/en/catalog`）の行。**scope="en" だけ**を返す＝JP面とは母集団が交わらない。
 *
 * 何を並べているか: 公式ストアの一覧に**今も載っている**が、日本の読者にとっては新着ではない
 * 在庫品（[[Projects/sedori_radar_en]] Phase 3）。
 *
 * 並び順は **店に並んだ日の新しい順**（`storeListedAt`）。`id`（＝こちらが初めて見た順）で
 * 並べてはいけない: 実測 2026-08-22、初回取り込みは店の新着順に挿入されるので `id` 降順が
 * **公開の古い順**になり、カタログの先頭が2021年の商品で埋まった。しかも窓の外から後で
 * 落ちてくる行は必ず後の id を持つので、どちら向きに並べても店の順序は復元できない。
 *
 * 掲載の整理（重複解消・非商品投稿の除外）は一覧と同じ `dedupeItems` を通す。**ここで自前の
 * 絞り込みを書かない**＝表示範囲の定義を1か所に揃える（src/lib/pages.ts のコメントと同じ理由）。
 */
export async function getEnCatalogItems(source?: string, take = 4000) {
  const rows = await prisma.item.findMany({
    where: source ? { scope: EN_ONLY_SCOPE, source } : { scope: EN_ONLY_SCOPE },
    orderBy: [{ storeListedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
    take,
  });
  return dedupeItems(rows);
}

/**
 * EN専用カタログのハブ用: 店ごとの件数と「最後に確認した時刻」。
 *
 * 件数は `groupBy` で数える（全行を取ってから数えない＝1店2,900件×4店を毎回メモリに載せない）。
 * ⚠️ この件数は **dedupeItems を通す前**の値なので、店ページの表示件数と1〜数件ずれうる。
 * 画面ではハブに件数を書かない（＝嘘の数字を出さない）で、リンク先の見出しで実数を出す。
 */
export async function getEnCatalogStoreStats(): Promise<Map<string, { count: number; oldestSeenAt: Date | null }>> {
  const rows = await prisma.item.groupBy({
    by: ["source"],
    where: { scope: EN_ONLY_SCOPE },
    _count: { _all: true },
    _min: { scrapedAt: true },
  });
  return new Map(rows.map((r) => [r.source, { count: r._count._all, oldestSeenAt: r._min.scrapedAt ?? null }]));
}

/** 最終更新時刻（最新の scrapedAt）だけを返す。
 *  以前は表示スコープの total も数えていたが、トップの「掲載 N件」は重複解消後の
 *  items.length と一致させる方針になり total は未使用になったため、その count クエリは廃止。 */
export async function getLastUpdated(): Promise<Date | null> {
  const latest = await prisma.item.findFirst({
    orderBy: { scrapedAt: "desc" },
    select: { scrapedAt: true },
  });
  return latest?.scrapedAt ?? null;
}
