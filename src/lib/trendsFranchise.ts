// `/en/trends` の「4週間ビュー」＝**日本の企業がいまどの作品に賭けているか**（2026-09-13 新設）。
//
// トレンド発信の順番の3段目（[[Projects/sedori_radar_en]] §トレンド発信）。土台の `DailySnapshot` は
// 2026-08-22 から貯まっているが、**観測できた日は23日中11日**（Turso ブロックと巡回停止で 8/25〜9/1・
// 9/8〜9/11 が空白）。空白を「その週は何も無かった」と語らないために、ここで言うのは
// 「観測した日の間に**初めて見た**行の数」だけ＝ snapshot の `newCount` を窓の中で足す。
//
// **数え方の約束（src/lib/snapshot.ts と同じ）**:
//  ・`newCount` は「前回の観測以降に初めて見た id」で、観測が空いた分は次の観測日にまとめて入る
//    ＝空白があっても**合計は落ちない**（8/25〜9/1 の新着は 9/2 の +1220 に入っている）。
//    ただし入って出た行（消えた行）は数えられないので、この数字は**下振れ側**にしか転ばない。
//  ・窓の始まりの観測日は**境界**（その日の newCount は窓の外の期間を指す）ので足さない。
//  ・franchise 次元は**延べ**（1件が複数作品に当たる）。割合の分母にしない＝順位と件数だけ出す。
//  ・「作品名が付かない行」はこの面に出ない。「無い」と「判定できない」を混ぜない。
//  ・言えるのは「first seen（こちらの巡回で初めて見た）」まで。「発売」「人気」「伸びている」とは書かない。
//    店の公開日（storeListedAt）ではなく巡回の観測なので、上の週次ビューとは物差しが違う＝混ぜない。
import { prisma } from "./prisma";

export const TRENDS_LONG_WINDOW_DAYS = 28;

/** 作品名の英語表記。無いものは日本語のまま出す（推測で訳さない）。 */
export const FRANCHISE_EN: Record<string, string> = {
  ワンピース: "ONE PIECE",
  NARUTO: "NARUTO",
  僕のヒーローアカデミア: "My Hero Academia",
  "魔法少女まどか☆マギカ": "Puella Magi Madoka Magica",
  "Re:ゼロから始める異世界生活": "Re:ZERO",
  初音ミク: "Hatsune Miku",
  ポケモン: "Pokémon",
  ガンダム: "Gundam",
  ドラゴンボール: "Dragon Ball",
  遊戯王: "Yu-Gi-Oh!",
  NIKKE: "NIKKE",
  サンリオ: "Sanrio",
  葬送のフリーレン: "Frieren",
  ヴァイスシュヴァルツ: "Weiß Schwarz",
  鬼滅の刃: "Demon Slayer",
  ウマ娘: "Umamusume",
  呪術廻戦: "Jujutsu Kaisen",
  東方Project: "Touhou Project",
  チェンソーマン: "Chainsaw Man",
  たまごっち: "Tamagotchi",
  デジモン: "Digimon",
  ホロライブ: "hololive",
  ジョジョの奇妙な冒険: "JoJo's Bizarre Adventure",
  ちいかわ: "Chiikawa",
  "デュエル・マスターズ": "Duel Masters",
  アイドルマスター: "THE IDOLM@STER",
  プリキュア: "PreCure",
  五等分の花嫁: "The Quintessential Quintuplets",
  キングダム: "Kingdom",
  ウルトラマン: "Ultraman",
  仮面ライダー: "Kamen Rider",
  名探偵コナン: "Detective Conan",
  ハイキュー: "Haikyu!!",
  星のカービィ: "Kirby",
  推しの子: "Oshi no Ko",
  新世紀エヴァンゲリオン: "Evangelion",
  ラブライブ: "Love Live!",
  進撃の巨人: "Attack on Titan",
};

export function franchiseNameEn(key: string): string {
  return FRANCHISE_EN[key] ?? key;
}

export type SnapshotPoint = { day: Date; key: string; newCount: number | null; count: number; lotteryCount: number };

export type FranchiseFirstSeen = { key: string; name: string; firstSeen: number; current: number };

export type LongWindowSummary = {
  /** 境界の観測日（この日より後の newCount を足す） */
  from: Date;
  /** 最後の観測日 */
  to: Date;
  /** 窓の中で観測できた日数（境界を含まない） */
  observedDays: number;
  /** 窓の暦日数（from の翌日〜to） */
  calendarDays: number;
  franchises: FranchiseFirstSeen[];
  /** 抽選の割合（DB在籍ベース）。境界日と最終日。片方でも無ければ null */
  lotteryShare: { from: number; to: number } | null;
};

/**
 * 窓の中の観測から「作品別に初めて見た件数」を組み立てる（純関数・selftest対象）。
 *
 * @param franchiseRows dim="franchise" の snapshot 行（日付順でなくてよい）
 * @param totalRows     dim="total" の snapshot 行（抽選の割合用）
 * @param days          窓の長さ（暦日）。最後の観測日から遡り、**その範囲内で最も古い観測日**を境界にする
 * @param top           返す作品数
 * @returns null＝観測日が2日未満（比較の相手が無い＝何も言わない）
 */
export function summarizeLongWindow(
  franchiseRows: SnapshotPoint[],
  totalRows: SnapshotPoint[],
  days = TRENDS_LONG_WINDOW_DAYS,
  top = 12
): LongWindowSummary | null {
  const daysSorted = [...new Set([...franchiseRows, ...totalRows].map((r) => r.day.getTime()))].sort((a, b) => a - b);
  if (daysSorted.length < 2) return null;
  const to = daysSorted[daysSorted.length - 1];
  const earliest = to - days * 86_400_000;
  const inWindow = daysSorted.filter((d) => d >= earliest);
  if (inWindow.length < 2) return null;
  const from = inWindow[0];

  const firstSeen = new Map<string, number>();
  const current = new Map<string, number>();
  for (const r of franchiseRows) {
    const t = r.day.getTime();
    if (t > from && t <= to && r.newCount != null) firstSeen.set(r.key, (firstSeen.get(r.key) ?? 0) + r.newCount);
    if (t === to) current.set(r.key, r.count);
  }
  const franchises = [...firstSeen.entries()]
    .filter(([, n]) => n > 0)
    .map(([key, n]) => ({ key, name: franchiseNameEn(key), firstSeen: n, current: current.get(key) ?? 0 }))
    .sort((a, b) => b.firstSeen - a.firstSeen || a.name.localeCompare(b.name))
    .slice(0, top);

  const totalAt = (t: number) => totalRows.find((r) => r.day.getTime() === t);
  const t0 = totalAt(from);
  const t1 = totalAt(to);
  const lotteryShare =
    t0 && t1 && t0.count > 0 && t1.count > 0
      ? { from: t0.lotteryCount / t0.count, to: t1.lotteryCount / t1.count }
      : null;

  return {
    from: new Date(from),
    to: new Date(to),
    observedDays: inWindow.length - 1,
    calendarDays: Math.round((to - from) / 86_400_000),
    franchises,
    lotteryShare,
  };
}

/** DB から窓ぶんの snapshot を読んで要約する。null＝まだ言えるものが無い。 */
export async function getLongWindowSummary(days = TRENDS_LONG_WINDOW_DAYS): Promise<LongWindowSummary | null> {
  const last = await prisma.dailySnapshot.findFirst({ orderBy: { day: "desc" }, select: { day: true } });
  if (!last) return null;
  const since = new Date(last.day.getTime() - days * 86_400_000);
  const rows = await prisma.dailySnapshot.findMany({
    where: { day: { gte: since }, dim: { in: ["franchise", "total"] } },
    select: { day: true, dim: true, key: true, newCount: true, count: true, lotteryCount: true },
  });
  return summarizeLongWindow(
    rows.filter((r) => r.dim === "franchise"),
    rows.filter((r) => r.dim === "total"),
    days
  );
}

export function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}
