import type { prisma as PrismaInstance } from "../src/lib/prisma";
import { fetchHtmlDetectCharset, sleep } from "../src/scrapers/util";
import { takaraTomyEndedEvidence } from "../src/scrapers/takaratomyMall";

/**
 * タカラトミーモールの「受注が終わったのに載り続けている行」を、**商品ページで確かめてから**落とす。
 *
 * 直す対象の型（2026-08-19 実測）: スクレイパは「予約期間終了」のカードを `continue` で
 * 読み飛ばす。読み飛ばした行は `items` に入らないので **更新もされず削除もされない**＝
 * DBに居座る。突き合わせ削除（RECONCILE_UNDATED_SOURCES）は `eventDate: null` の行しか
 * 消さないので、発売日を持つ**予約**の行はどの経路にも当たらなかった。
 * 巡回直後の実測で、掲載197件のうち **27件**がこの状態（全て `[予約]`・全て将来日付）。
 *
 * なぜ「今回の巡回で見つからなかったから消す」ではないのか:
 * 一覧は新着/オリジナル/再入荷の3本だけなので、**まだ有効な予約が一覧から押し出される**。
 * 消えたことを根拠にすると、生きている予約を消す。だから**リンク先を開いて、その商品自身が
 * 終了と言っている場合だけ**消す（判定は takaraTomyEndedEvidence・誤検知3型を潰してある）。
 *
 * なぜ独立した関数なのか: cleanupRecentWindow.ts と同じ理由で、**巡回を回さずに単体で呼べる**
 * ようにするため。36分の巡回を回さないと一度も動かせない掃除は、入れた日に確かめられない。
 *
 * 呼び出し側の約束: **巡回が成功した回だけ呼ぶ**（失敗した回に呼ぶと、取りこぼした行を
 * 全部フェッチしにいく）。
 */
export async function cleanupTakaraTomyEnded(
  prisma: typeof PrismaInstance,
  liveIds: string[],
  opts: { fetchHtml?: (url: string) => Promise<string>; maxChecks?: number } = {}
): Promise<{ checked: number; deleted: number; skipped: number }> {
  const fetchHtml = opts.fetchHtml ?? fetchHtmlDetectCharset;
  // 巡回で拾えなかった行だけが対象（拾えた行は今まさに「買える」と確認できている）。
  const live = new Set(liveIds);
  const rows = await prisma.item.findMany({
    where: { source: "takaratomy_mall" },
    select: { id: true, sourceId: true, title: true, url: true },
  });
  const targets = rows.filter((r: { sourceId: string }) => !live.has(r.sourceId));

  // 上限。巡回がほぼ空振りした回に全件フェッチしにいかないための歯止め。
  const max = opts.maxChecks ?? 400;
  if (targets.length > max) {
    console.log(
      `[takaratomy_mall] 未検出が ${targets.length}件（上限${max}）＝巡回が細っている可能性。確認は行わない`
    );
    return { checked: 0, deleted: 0, skipped: targets.length };
  }

  const doomed: number[] = [];
  for (const t of targets) {
    let html: string;
    try {
      html = await fetchHtml(t.url);
    } catch {
      // 取れなかったことを「終了」の根拠にしない（ネットワークの失敗で商品を消さない）。
      continue;
    }
    if (takaraTomyEndedEvidence(html)) doomed.push(t.id);
    await sleep(700);
  }
  if (doomed.length > 0) {
    await prisma.item.deleteMany({ where: { id: { in: doomed } } });
    console.log(`[takaratomy_mall] 受注終了が確認できた ${doomed.length}件を削除（確認 ${targets.length}件）`);
  } else {
    console.log(`[takaratomy_mall] 未検出 ${targets.length}件を確認・終了は 0件`);
  }
  return { checked: targets.length, deleted: doomed.length, skipped: 0 };
}
