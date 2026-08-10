/**
 * 「サイトが実際に表示しているアイテム」の単一の定義。
 *
 * ここを唯一の情報源にする理由: 監査・再エンリッチ・相場付与がそれぞれ独自の where 句で
 * 対象を決めていたため、同じ「表示スコープ」のつもりでも中身がズレ、**どこかのページには
 * 出ているのに、どの処理からも触られない行**が生まれていた（実測: /premium が監査の外、
 * 月ページの"当月の過ぎた日"が再エンリッチの外＝未確認の「抽選賞品：」が固着）。
 *
 * 新しいページを作ったら、ここに1行足す。足せば監査もエンリッチも自動で追随する。
 *
 * この定義を使う側:
 *   - scripts/audit.ts        … データの不変条件（表示される全件に対して）
 *   - scripts/auditRendered.ts … 描画結果（このページ一覧を実際に取得して検査）
 *   - scripts/reenrichCollabo.ts … 再エンリッチの対象
 */
import { getItems } from "./items";
import {
  getItemsByGenre,
  getItemsByMonth,
  getLotteryItems,
  getMonthsWithItems,
} from "./seo";
import { getItemsByTcgTitle, getTcgTitleCounts } from "./tcg";
import { GENRE_ORDER } from "./itemFilter";

export type DisplayedPage = { name: string; rows: Awaited<ReturnType<typeof getItems>> };

/** 各ページが実際に描画する行を、ページ単位で返す。 */
export async function loadDisplayedPages(): Promise<DisplayedPage[]> {
  const pages: DisplayedPage[] = [];
  pages.push({ name: "/", rows: await getItems({}) });
  // /premium（相場・プレ値ランキング）は 2026-08-10 に表示を取り下げた（getPremiumItems の
  // コメント参照）。ページが無い＝表示範囲にも無い。復活させるならここに1行戻す。
  pages.push({ name: "/lottery", rows: await getLotteryItems() });
  for (const g of GENRE_ORDER) {
    const rows = await getItemsByGenre(g);
    if (rows.length) pages.push({ name: `/genre/${g}`, rows });
  }
  for (const m of await getMonthsWithItems()) {
    const rows = await getItemsByMonth(m);
    if (rows.length) pages.push({ name: `/release/${m}`, rows });
  }
  for (const { label } of await getTcgTitleCounts()) {
    const rows = await getItemsByTcgTitle(label);
    if (rows.length) pages.push({ name: `/tcg/${label}`, rows });
  }
  return pages;
}

/** 全ページの和集合（id 重複を排除）＝サイトが今見せている全件。 */
export async function loadDisplayedItems() {
  const byId = new Map<number, DisplayedPage["rows"][number]>();
  for (const p of await loadDisplayedPages()) for (const r of p.rows) byId.set(r.id, r);
  return [...byId.values()];
}
