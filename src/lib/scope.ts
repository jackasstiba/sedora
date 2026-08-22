// 掲載スコープ（Phase 3a・2026-08-22）。
//
// EN専用行（scope="en"）＝公式ストアの「新着窓の外だが店にはまだ並んでいる現行商品」。
// 日本の読者には新着でなくなった時点で価値が無いが、海外読者には Japan-only なので
// /en/catalog（Phase 3b で新設）にだけ出す。既存全行は scope=null（＝日英両方）。
//
// 規約:
//  ・JP面（日本語ページと /en のミラー面）の取得クエリは必ず JP_SCOPE_WHERE を通す。
//    適用漏れ（新しいページ関数がフィルタを忘れる型）は audit `en_scope_leak` が ERROR で落とす。
//  ・"jp"（JP専用）は必要になるまで作らない（要らない値を先に作ると分岐だけ増える）。
import type { Prisma } from "@/generated/prisma/client";
import { enCatalogPagePaths } from "./enCatalog";

/** EN専用行の scope 値。 */
export const EN_ONLY_SCOPE = "en";

/** JP面に出してよい行か（null/未設定＝日英両方なので true）。 */
export function isJpScope(scope: string | null | undefined): boolean {
  return scope !== EN_ONLY_SCOPE;
}

/**
 * JP面の取得クエリに AND で入れる where 断片。
 * `scope: { not: "en" }` 単体は使わない — SQL の `NULL <> 'en'` は真にならないので、
 * **既存全行（scope=null）が丸ごと消える**。null を OR で明示する。
 */
export const JP_SCOPE_WHERE: Prisma.ItemWhereInput = {
  OR: [{ scope: null }, { scope: { not: EN_ONLY_SCOPE } }],
};

/** scope="en" の行を出してよいページ（登録簿から導出＝ページを増やしても書き漏れない）。 */
export const EN_ONLY_PAGES: ReadonlySet<string> = new Set<string>(enCatalogPagePaths());

/**
 * カタログ行について画面が言ってよい**唯一の事実**＝「この日、まだ公式ストアの一覧にあった」。
 *
 * 在庫・海外購入の可否・入手容易さは約束しない（[[UIラベルは裏取り済みのみ約束]]）。
 * 引数は行の `scrapedAt`（巡回でその行を実際に見た瞬間）。`todayJst()` を読まない＝
 * **暦が進むだけで表示が変わらない**（audit:tomorrow / audit:clock で鳴らない側を実測する）。
 *
 * 月は必ず綴り、年も必ず出す（"8/22" は米英で読みが割れる／古いカタログを今年と誤読させない）。
 * 曜日は付けない: カウントダウンと突き合わせる相手ではないので、画面監査の日付突合に
 * 拾わせる意味が無い（拾わせると「バッジの無い日付」を毎回説明することになる）。
 */
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function seenOnStoreEn(scrapedAt: Date | string): string {
  // 日本時間の暦日に直す（保存値は瞬間。UTCのまま読むと JST 早朝の巡回が前日になる）。
  const j = new Date(new Date(scrapedAt).getTime() + 9 * 60 * 60 * 1000);
  return `${MONTHS_EN[j.getUTCMonth()]} ${j.getUTCDate()}, ${j.getUTCFullYear()}`;
}

/**
 * 一覧に並ぶ行のうち**最も古い**確認時刻。ページ全体で1回だけ「いつ確認したか」を書くとき、
 * 全行に等しく当てはまる（＝嘘にならない）のは最も古い側。
 */
export function oldestSeenAt<T extends { scrapedAt: Date | string }>(rows: T[]): Date | null {
  let oldest: number | null = null;
  for (const r of rows) {
    const ms = new Date(r.scrapedAt).getTime();
    if (!Number.isFinite(ms)) continue;
    if (oldest === null || ms < oldest) oldest = ms;
  }
  return oldest === null ? null : new Date(oldest);
}

/**
 * 監査用の純関数: 表示ページ一覧の中で、EN専用行が許可ページ以外に出ている箇所を列挙する。
 * 鳴る側/鳴らない側は audit:selftest で固定（audit はこれを loadDisplayedPages の出力に当てる）。
 */
export function enScopeLeaks(
  pages: { name: string; rows: { id: number; scope?: string | null }[] }[],
  allow: ReadonlySet<string> = EN_ONLY_PAGES
): string[] {
  const out: string[] = [];
  for (const p of pages) {
    if (allow.has(p.name)) continue;
    for (const r of p.rows) {
      if (!isJpScope(r.scope)) out.push(`${p.name} #${r.id}`);
    }
  }
  return out;
}
