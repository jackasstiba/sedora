/**
 * リンク先が**URLとして壊れている**か。壊れていれば理由、正常なら null。
 *
 * 実測 2026-09-12: pokemoncard の拡張パック「30th CELEBRATION」の url が
 * 「https://www.pokemon-card.comhttps://www.30th.pokemon-card.com/product/m6a」だった
 * （相対パス前提で ORIGIN を前置したところへ、公式APIが絶対URLを返すようになった）。
 * ブラウザは `www.pokemon-card.comhttps` をホスト名として解決しに行き、当然開けない。
 *
 * 見るのは形だけ（到達性は audit:links）。ここが通っても開けるとは限らないが、
 * ここで落ちるものは**必ず**開けない。
 */
export function isMalformedUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "URLとして解釈できない";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return `スキームが ${u.protocol}`;
  if (!u.hostname || !u.hostname.includes(".")) return "ホスト名が無い";
  // 「host.comhttps://…」＝前置の事故。ホスト名にスキーム文字列が混ざる。
  if (/https?/i.test(u.hostname)) return "ホスト名に http が混ざっている（前置の事故）";
  // 「/https://…」＝パスに絶対URLが入っている（同じ事故の別形）。
  if (/^\/https?:\/\//i.test(u.pathname)) return "パスの先頭に絶対URLが入っている";
  return null;
}
