/**
 * 文字と背景のコントラスト比（WCAG 2.1 の相対輝度）。**純関数**。
 *
 * なぜ要るか（2026-08-17 実測）: 観点H（見た目・可読性）は audit / audit:page /
 * audit:facts のどれからも見えない。3つとも「文字列」しか見ていないので、
 * *読めるかどうか* は素通りする。実際、本番のカードの日付（いちばん読ませたい情報）が
 * ブランド色 #ef5322 の 12px で **3.54:1**（AA は 4.5:1）のまま公開されていた。
 * 120枚＋バッジ42枚が該当し、audit は ERROR 0 だった。
 *
 * 色を決め直すだけでは同じことが起きる（ミス2 は 2026-05 にも踏んでいる）ので、
 * **パレットの下限を機械で固定する**。`audit:selftest` の `brand_contrast` が
 * `src/app/globals.css` を実際に読んでこの関数に通すため、CSS を戻すと検査が落ちる。
 */

export type Rgb = { r: number; g: number; b: number };

/** "#rgb" / "#rrggbb" を 0..255 に。読めなければ null（呼び出し側で ERROR にする）。 */
export function parseHex(hex: string): Rgb | null {
  const s = hex.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    return {
      r: parseInt(s[0] + s[0], 16),
      g: parseInt(s[1] + s[1], 16),
      b: parseInt(s[2] + s[2], 16),
    };
  }
  if (/^[0-9a-fA-F]{6}$/.test(s)) {
    return {
      r: parseInt(s.slice(0, 2), 16),
      g: parseInt(s.slice(2, 4), 16),
      b: parseInt(s.slice(4, 6), 16),
    };
  }
  return null;
}

/** WCAG の相対輝度（sRGB を線形化して加重和）。 */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** コントラスト比（1〜21）。順序は問わない。 */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 16進どうしのコントラスト比。どちらかが読めなければ null。 */
export function contrastHex(aHex: string, bHex: string): number | null {
  const a = parseHex(aHex);
  const b = parseHex(bHex);
  if (!a || !b) return null;
  return contrastRatio(a, b);
}

/**
 * WCAG AA の必要比。大きい文字（24px以上、または 18.66px以上の太字）だけ 3.0 でよい。
 * ハツコレでブランド色が乗っているのは 12〜14px（日付・バッジ・ボタン）なので、
 * 既定は小さい文字＝4.5 で判定する。
 */
export const AA_NORMAL = 4.5;
export const AA_LARGE = 3;

/** globals.css から `--name: #xxxxxx;` を1つ読む（検査が実ファイルを見るため）。 */
export function readCssHexToken(css: string, name: string): string | null {
  const m = new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{3,8})\\s*;`).exec(css);
  return m ? m[1] : null;
}
