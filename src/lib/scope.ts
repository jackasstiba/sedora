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

/** scope="en" の行を出してよいページ（Phase 3b で "/en/catalog" を足す）。 */
export const EN_ONLY_PAGES: ReadonlySet<string> = new Set<string>([]);

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
