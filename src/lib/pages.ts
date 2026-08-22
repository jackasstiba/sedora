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
import { getEnCatalogItems, getItems } from "./items";
import {
  getItemsByGenre,
  getItemsByMonth,
  getLotteryItems,
  getMonthsWithItems,
} from "./seo";
import { getItemsByTcgTitle, getTcgTitleCounts } from "./tcg";
import { GENRE_ORDER } from "./itemFilter";
import { EN_CATALOG_HUB_PATH, EN_CATALOG_STORES, enCatalogPath } from "./enCatalog";

/** ハブ（/en/catalog）が店ごとに並べる先頭の枚数。ページ側と共有する（ズレると監査が鳴る）。 */
export const EN_CATALOG_PREVIEW = 12;

export type DisplayedPage = { name: string; rows: Awaited<ReturnType<typeof getItems>> };

/** 各ページが実際に描画する行を、ページ単位で返す。 */
export async function loadDisplayedPages(): Promise<DisplayedPage[]> {
  const pages: DisplayedPage[] = [];
  const home = await getItems({});
  pages.push({ name: "/", rows: home });
  // 英語版トップ。データ・掲載スコープは "/" と**同一の取得結果**（表示層だけが英語）。
  // ここに載せることで audit:page が /en も取得して検査する（広告表示・収集元リーク・
  // 件数突合・日付突合の英語書式は auditRendered 側が両言語を読む）。
  pages.push({ name: "/en", rows: home });
  // EN専用カタログ（Phase 3b/3b'）。**ここだけが scope="en" を出してよい面**（src/lib/scope.ts の
  // EN_ONLY_PAGES と対。両方とも src/lib/enCatalog.ts の登録簿から導出するのでズレようがない）。
  // ハブは店ごとの先頭 EN_CATALOG_PREVIEW 件だけを描くので、**描く分だけを登録する**
  // （全件を登録すると audit:page の「描画枚数の食い違い」が必ず鳴る）。
  const hubRows: DisplayedPage["rows"] = [];
  for (const store of EN_CATALOG_STORES) {
    const rows = await getEnCatalogItems(store.source);
    if (!rows.length) continue;
    hubRows.push(...rows.slice(0, EN_CATALOG_PREVIEW));
    pages.push({ name: enCatalogPath(store.slug), rows });
  }
  pages.push({ name: EN_CATALOG_HUB_PATH, rows: hubRows });
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
