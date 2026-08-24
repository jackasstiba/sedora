// 日次スナップショット（2026-08-22 新設）＝**この先トレンドを語るための、唯一の材料**。
//
// なぜ要るか: **このDBは過去を持っていない。**
//  ・`Item.scrapedAt` は巡回のたびに上書きされる（scripts/scrape.ts の upsert）＝初見日ではない。
//  ・「一覧から落ちた行」を消す収集元がある（deleteMissing / cleanup*）＝行ごと消える。
//  ・差分を持つ表も無い。
// つまり「先週と比べて何が増えたか」は、**今あるデータからは永久に計算できない**。
// 歴史は後から作れない唯一のもので、貯め始めた日より前は取り返せない。だから1日1行ずつ残す。
//
// **ここが数えるのは「DBの在籍件数」であって、サイトの表示件数ではない。**
// 表示範囲は src/lib/pages.ts が唯一の定義で、掲載基準は今後も変わる。変わる物差しで数えた列は
// 日をまたいで比較できない（去年の秤で量った体重と比べることになる）ので、スナップショットは
// **生の在籍数**だけを持つ。表示の話をしたい時は scope 次元で切る。
//
// この値を画面や投稿に出すときの約束（[[UIラベルは裏取り済みのみ約束]]）:
//  ・"Listed" とは言わない（表示件数ではない）。言えるのは「収集した中で何件あったか」まで。
//  ・newCount=null は「不明」であって 0 ではない。**既定値に語らせない**——
//    行が無い日を「新着ゼロの日」として描かない。
import { matchFranchises } from "./franchise";
import { isLotteryItem } from "./itemFilter";

/** 何で束ねた行か。**"franchise" だけは延べ**（下の buildSnapshotRows のコメント参照）。 */
export type SnapshotDim = "total" | "source" | "genre" | "franchise" | "scope";

export const SNAPSHOT_DIMS: readonly SnapshotDim[] = ["total", "source", "genre", "franchise", "scope"];

/** total 次元の唯一のキー。境界(maxItemId)を引くのもこの行。 */
export const TOTAL_KEY = "all";

/** スナップショットが読む Item の列だけ（増やす時はここと SELECT を一緒に直す）。 */
export type SnapshotInput = {
  id: number;
  source: string;
  genre: string;
  eventType: string;
  title: string;
  eventDate: Date | string | null;
  hasLottery: boolean | null;
  scope: string | null;
};

export type SnapshotRow = {
  dim: SnapshotDim;
  key: string;
  /** その日にDBに在籍していた件数。 */
  count: number;
  /**
   * そのうち「前回スナップショット日より後に初めて見た」件数。
   * **null＝不明**（前回が無い＝初回）。0 と混同しない: 初回に全件を「今日の新着」と数えると、
   * 貯め始めた日だけ巨大な山が立ち、その嘘がグラフに永久に残る。
   */
  newCount: number | null;
  /** 抽選・ランダム性のある件数（判定は表示層と同じ isLotteryItem＝物差しを2つ持たない）。 */
  lotteryCount: number;
  /** 日付（eventDate）が確定している件数。日付なしの比率は収集元の健全性の指標でもある。 */
  datedCount: number;
  /** そのグループ内の最大 Item.id。total 行のこれが**次回の「新着」の境界**になる。 */
  maxItemId: number;
};

// キーは dim/key を**値の側に持つ**（Map のキーを "dim key" と連結すると、空白を含む収集元名や
// 作品名でほどけなくなる。将来キーに何が入るかはこちらでは決められない）。
type Agg = {
  dim: SnapshotDim;
  key: string;
  count: number;
  newCount: number;
  lotteryCount: number;
  datedCount: number;
  maxItemId: number;
};

/**
 * 在籍中の全行 → その日の集計行。**純関数**（時計もDBも読まない）。
 *
 * @param items 在籍中の全 Item（表示範囲で絞らない＝上のコメントの通り）
 * @param boundaryItemId 前回スナップショットの total.maxItemId。null＝初回（newCount は不明）
 *
 * 「新着」を **id で数える理由**: 初見日を持つ列が無く、scrapedAt は毎回上書きされるため、
 * 単調増加する id だけが「こちらが初めて見た順」を保っている（scrape.ts の storeListedAt の
 * コメントにも同じ注記がある）。ただし id は**まだ在籍している行しか数えられない**ので、
 * 入って出た行（同じ期間に消えた新着）は落ちる。newCount は「今日も残っている新着」であって
 * 「この期間に現れた総数」ではない。**上振れではなく下振れする**ので、数字を大きく見せる側には
 * 転ばない（[[指摘は1件開いてから数える]]の逆側＝控えめに転ぶ方を選ぶ）。
 *
 * **franchise 次元だけは延べ**: 1件のタイトルが複数作品に当たる（例「ワンピース×鬼滅」）。
 * 作品名が付かない行はこの次元に**出さない**（0件として並べると「無い」と「判定できない」が
 * 混ざる）。したがって franchise の合計は total と一致しない。割合の分母に使わないこと。
 */
export function buildSnapshotRows(items: SnapshotInput[], boundaryItemId: number | null): SnapshotRow[] {
  const buckets = new Map<string, Agg>();

  const add = (dim: SnapshotDim, key: string, it: SnapshotInput) => {
    const id = `${dim}\u0000${key}`;
    let a = buckets.get(id);
    if (!a) {
      a = { dim, key, count: 0, newCount: 0, lotteryCount: 0, datedCount: 0, maxItemId: 0 };
      buckets.set(id, a);
    }
    a.count++;
    if (boundaryItemId !== null && it.id > boundaryItemId) a.newCount++;
    if (isLotteryItem(it)) a.lotteryCount++;
    if (it.eventDate !== null) a.datedCount++;
    if (it.id > a.maxItemId) a.maxItemId = it.id;
  };

  for (const it of items) {
    add("total", TOTAL_KEY, it);
    add("source", it.source, it);
    add("genre", it.genre, it);
    // scope=null は「日英両方に出す既存行」＝JP面に出る側（src/lib/scope.ts の規約と同じ読み）。
    add("scope", it.scope === "en" ? "en" : "jp", it);
    for (const g of matchFranchises(it.title)) add("franchise", g[0], it);
  }

  const dimOrder = new Map(SNAPSHOT_DIMS.map((d, i) => [d, i]));
  return [...buckets.values()]
    .map((a) => {
      return {
        dim: a.dim,
        key: a.key,
        count: a.count,
        newCount: boundaryItemId === null ? null : a.newCount,
        lotteryCount: a.lotteryCount,
        datedCount: a.datedCount,
        maxItemId: a.maxItemId,
      };
    })
    // 並びを固定する（同じ入力なら毎回同じ出力＝差分を目で追える／自己テストが安定する）。
    .sort((x, y) => (dimOrder.get(x.dim)! - dimOrder.get(y.dim)!) || x.key.localeCompare(y.key));
}

/** total 行（次回の境界を引く先）。無ければ null＝境界なし＝次回も newCount は不明。 */
export function totalRow(rows: SnapshotRow[]): SnapshotRow | null {
  return rows.find((r) => r.dim === "total" && r.key === TOTAL_KEY) ?? null;
}
