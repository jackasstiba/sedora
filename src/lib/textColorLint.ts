/**
 * 「ライト表示で読めない文字色クラス」をソースから見つける（純関数）。
 *
 * なぜページを見る検査では足りないか（2026-08-17 実測・これは私の報告の誤りから出た）:
 * ブラウザで塗って測る方法は正しいが、**測ったページの分しか分からない**。
 * トップページで「ライト 177→0件」を確認して「0件」と報告したが、
 * 実際には `/release/*`（カレンダーの日曜 rose-500 = 2.74:1・土曜 blue-500 = 3.55:1・
 * 日付 neutral-400 = 2.44:1）と `/items/*`（見出し neutral-500 = 4.48:1）に残っていた。
 * さらに `ItemBrowser` の「該当する商品が見つかりませんでした。」は**絞り込みが0件のときしか
 * 描画されない**ので、どのページを開いても出会えない。
 * → 画面ではなく**クラス名**を見れば、描かれない状態も含めて全部数えられる。
 *
 * 見る対象: 変種プレフィックスの付かない**素のクラス**だけ（`dark:` はダーク面で使うので対象外、
 * `hover:` 等は一時状態）。ライトの2面（地色＝生成り／カード＝白）の**厳しい方**で AA を判定する。
 */
import { AA_NORMAL, contrastHex } from "./contrast";

/** ライト表示で文字が乗る2つの面。 */
export const LIGHT_SURFACES = ["#fbf8f3", "#ffffff"] as const;

/**
 * 判定に使う色見本。Tailwind の既定値だが、rose だけは globals.css で
 * ブランド色に差し替えてあるので**そちらの値を渡す**（呼び出し側が CSS から読む）。
 */
export const TAILWIND_TEXT_COLORS: Record<string, string> = {
  "neutral-50": "#fafafa",
  "neutral-100": "#f5f5f5",
  "neutral-200": "#e5e5e5",
  "neutral-300": "#d4d4d4",
  "neutral-400": "#a1a1a1",
  "neutral-500": "#737373",
  "neutral-600": "#525252",
  "neutral-700": "#404040",
  "neutral-800": "#262626",
  "neutral-900": "#171717",
  "blue-300": "#8ec5ff",
  "blue-500": "#3b82f6",
  "blue-700": "#1d4ed8",
  "blue-800": "#1e40af",
  "purple-100": "#f3e8ff",
  "purple-200": "#e9d5ff",
  "purple-300": "#d8b4fe",
  "purple-700": "#7e22ce",
  "purple-800": "#6b21a8",
  "purple-900": "#581c87",
  "amber-200": "#fde68a",
  "amber-300": "#fcd34d",
  "amber-800": "#92400e",
};

/**
 * 判定しないもの。**必ずファイルとセットで持つ。**
 *
 * クラス名だけで例外にすると、いちばん多かった `text-neutral-400`（元の不具合10件の出どころ）が
 * **どのファイルに書いても永久に無視される**＝この検査が最も効いてほしい相手に効かなくなる。
 * 理由も1件ずつ書く。書かずに足すと、ここは「都合の悪いものを黙らせる場所」に変わる
 * （[[System/rules]] の audit:tomorrow の除外リストと同じ約束）。
 */
export const TEXT_COLOR_EXCEPTIONS: { file: string; cls: string; why: string }[] = [
  {
    file: "src/components/FilterBar.tsx",
    cls: "text-neutral-400",
    why: "押せないジャンルチップ（cursor-not-allowed）。WCAG は無効化された操作部品をコントラスト要件の対象外にしている。薄いことが「押せない」の意味を担っている。",
  },
  {
    file: "src/app/items/[id]/page.tsx",
    cls: "text-neutral-300",
    why: "賞品画像が無いときの 🎁 プレースホルダ。カラー絵文字は自分の色で描かれるので文字色はほぼ効かない（装飾であって読ませる文字ではない）。",
  },
];

/** パス区切りの違い（Windows の \ ）を吸収して比較する。 */
function sameFile(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/\\/g, "/").replace(/^\.\//, "");
  return norm(a).endsWith(norm(b));
}

/** 変種プレフィックス（dark:/hover: など）が付かない素の text-<色> だけを拾う。 */
const BASE_TEXT_CLASS = /(?<![\w:-])text-((?:neutral|rose|blue|purple|amber|green|red|orange)-\d{2,3})\b/g;

export type TextColorFinding = { cls: string; hex: string; worst: number; surface: string };

/**
 * ソース1ファイル分から、ライト表示で AA に届かない素の文字色クラスを返す。
 * 例外は**そのファイルに限って**効く（`filePath` を渡さなければ例外は一切効かない）。
 */
export function findLowContrastTextClasses(
  source: string,
  palette: Record<string, string>,
  filePath = ""
): TextColorFinding[] {
  const seen = new Map<string, TextColorFinding>();
  for (const m of source.matchAll(BASE_TEXT_CLASS)) {
    const name = m[1];
    const cls = `text-${name}`;
    if (TEXT_COLOR_EXCEPTIONS.some((e) => e.cls === cls && filePath && sameFile(filePath, e.file)))
      continue;
    const hex = palette[name];
    if (!hex) continue; // 色見本に無い＝判定できない（黙って通す方が誤報より良い）
    let worst = Infinity;
    let surface = "";
    for (const bg of LIGHT_SURFACES) {
      const r = contrastHex(hex, bg);
      if (r !== null && r < worst) {
        worst = r;
        surface = bg;
      }
    }
    if (worst < AA_NORMAL && !seen.has(cls))
      seen.set(cls, { cls, hex, worst: Math.round(worst * 100) / 100, surface });
  }
  return [...seen.values()];
}
