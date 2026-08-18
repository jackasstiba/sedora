/**
 * 収集元名をブラウザへ渡すときの「伏せ字」。
 *
 * なぜ要るか（2026-08-18 実測）: 詳細ページの計測用ラッパー(OutboundLink)に
 * `source={item.source}` を渡していたため、**内部名がそのまま配信物に載っていた**
 * （collabo_cafe / torecasoku / tenbaiquest …）。内部名は収集元そのものの名前なので、
 * リンクとURLを隠しても名前が残れば非公開にならない。
 *
 * かといって計測を捨てると「どの面が収益に効いたか」が分からなくなる。そこで
 * **区別はできるが名前は読めない**短い符号にして送る。符号→名前の対応は
 * `decodeSourceCode` でこちら側だけが復元できる（対応表を持ち歩く必要はない＝
 * 収集元が増えても何も更新しなくてよい）。
 */

/** FNV-1a（32bit）。imageProxy と同じ計算だが、用途が別なので別関数として持つ。 */
function hash36(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** 収集元名 → 送ってよい符号（例: "collabo_cafe" → "s1a2b3c"）。 */
export function sourceCode(source: string): string {
  return `s${hash36(source)}`;
}

/**
 * 符号 → 収集元名。候補（DBに実在する source の一覧）を渡して突き合わせる。
 * 見つからなければ符号のまま返す（読めない値で落とさない）。
 */
export function decodeSourceCode(code: string, sources: readonly string[]): string {
  for (const s of sources) if (sourceCode(s) === code) return s;
  return code;
}
