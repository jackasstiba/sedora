/**
 * その日の在籍状況を DailySnapshot に1日分書く（`npm run snapshot`／巡回の最後で自動実行）。
 *
 * **なぜ巡回の中から呼ぶのか**: 別コマンドに分けると「人が覚えている」に依存する。
 * 同じ型で実際に事故っている——画像の後付けが `scrape:images` という別コマンドだった間、
 * `npm run scrape` を直に叩いた更新では画像なしの新着がそのまま公開され、画像なしが
 * 83→152件に増えた（audit `scrape_skips_images` はその再発防止）。
 * スナップショットはもっと不利で、**取り逃した日は二度と埋められない**（在籍数は「今」しか
 * 読めない。過去の日を後から数え直す材料がDBに無い）。だから更新の一部として回す。
 *
 * 冪等: 同じ日に何度走っても行は増えない（day+dim+key で上書き＝その日の最後に見た姿が残る）。
 */
import { prisma } from "../src/lib/prisma";
import { todayJst } from "../src/lib/date";
import { TOTAL_KEY, buildSnapshotRows, totalRow, type SnapshotInput } from "../src/lib/snapshot";

type Db = typeof prisma;

export type SnapshotResult = {
  day: Date;
  rows: number;
  items: number;
  /** null＝この回は「新着」を数えられない（比較相手が無い＝初回）。 */
  newItems: number | null;
  boundaryItemId: number | null;
};

export async function writeDailySnapshot(db: Db = prisma): Promise<SnapshotResult> {
  const day = todayJst(); // 壁時計を読むのは date.ts だけ（audit の clock_discipline）

  // 「新着」の境界は**前の日**のスナップショットから引く。同じ日の行を見てしまうと、
  // 1日2回巡回した2回目が「午前中に入った分」を新着から外す＝日ごとの数が回数で変わる。
  const prev = await db.dailySnapshot.findFirst({
    where: { dim: "total", key: TOTAL_KEY, day: { lt: day } },
    orderBy: { day: "desc" },
    select: { maxItemId: true, day: true },
  });
  const boundaryItemId = prev?.maxItemId ?? null;

  // 表示範囲で絞らない（在籍数を数える＝掲載基準が変わっても日をまたいで比べられる）。
  const items: SnapshotInput[] = await db.item.findMany({
    select: {
      id: true,
      source: true,
      genre: true,
      eventType: true,
      title: true,
      eventDate: true,
      hasLottery: true,
      scope: true,
    },
  });

  const rows = buildSnapshotRows(items, boundaryItemId);

  for (const r of rows) {
    const data = {
      count: r.count,
      newCount: r.newCount,
      lotteryCount: r.lotteryCount,
      datedCount: r.datedCount,
      maxItemId: r.maxItemId,
    };
    await db.dailySnapshot.upsert({
      where: { day_dim_key: { day, dim: r.dim, key: r.key } },
      create: { day, dim: r.dim, key: r.key, ...data },
      update: data,
    });
  }

  const total = totalRow(rows);
  return {
    day,
    rows: rows.length,
    items: items.length,
    newItems: total?.newCount ?? null,
    boundaryItemId,
  };
}

/** 実行時のログ。**数えられなかったものを 0 と書かない**（[[既定値に語らせない]]）。 */
export function describeSnapshot(r: SnapshotResult): string {
  const d = r.day.toISOString().slice(0, 10);
  const nw =
    r.newItems === null
      ? "新着: 不明（比較相手のスナップショットがまだ無い＝次回から数えられる）"
      : `新着: ${r.newItems}件（前回スナップショット以降に初めて見た行のうち、今も在籍しているもの）`;
  return `[snapshot] ${d}（JST）: 在籍 ${r.items}件 / 集計 ${r.rows}行 / ${nw}`;
}

// 単体実行（`npm run snapshot`）。巡回から import された時は走らせない。
if (process.argv[1] && process.argv[1].endsWith("snapshot.ts")) {
  writeDailySnapshot()
    .then(async (r) => {
      console.log(describeSnapshot(r));
      await prisma.$disconnect();
    })
    .catch(async (e) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
