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

/**
 * ライト表示で文字が乗る面。**「地色と白」だけでは足りない。**
 *
 * 実測（2026-08-17・この検査を入れた直後に本番で取りこぼした）: 月カレンダーの
 * 「その日に商品がある」セルは `bg-rose-50` の淡い色で塗ってあり、そこに乗る日曜の
 * 日付が **4.46:1** だった。地色(#fbf8f3)と白(#ffffff)しか見ていなかったので、
 * 検査は緑のまま素通りしていた。**塗った面を足すたびにここへ1行足す。**
 */
export const LIGHT_SURFACES = [
  "#fbf8f3", // 地色（body）
  "#ffffff", // カード（bg-white）
  "#fff4ee", // 淡いブランド色の面（bg-rose-50。カレンダーの「商品がある日」など）
] as const;

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

/**
 * ダーク表示で文字が乗る面。`dark:` の指定が無いクラスは**両方のテーマで使われる**ので、
 * こちらでも AA を満たしていないといけない。
 */
export const DARK_SURFACES = [
  "#0f0c0a", // 地色（ダークの body）
  "#171717", // カード（dark:bg-neutral-900）
] as const;

/** 変種プレフィックス（dark:/hover: など）が付かない素の text-<色> だけを拾う。 */
const BASE_TEXT_CLASS = /(?<![\w:-])text-((?:neutral|rose|blue|purple|amber|green|red|orange)-\d{2,3})\b/g;
/** クラス名を含む文字列リテラル（"..." / '...' / `...`）。この単位で dark: の有無を見る。 */
const CLASS_LITERAL = /"[^"]*"|'[^']*'|`[^`]*`/g;

export type TextColorFinding = {
  cls: string;
  hex: string;
  worst: number;
  surface: string;
  theme: "light" | "dark";
};

function worstAgainst(hex: string, surfaces: readonly string[]): { worst: number; surface: string } {
  let worst = Infinity;
  let surface = "";
  for (const bg of surfaces) {
    const r = contrastHex(hex, bg);
    if (r !== null && r < worst) {
      worst = r;
      surface = bg;
    }
  }
  return { worst, surface };
}

/**
 * ソース1ファイル分から、AA に届かない素の文字色クラスを返す。
 *
 * 判定の単位は**文字列リテラル1つ**（className の中身 / クラス名を持つ変数の代入）。
 *  ・そのリテラルに `dark:text-*` がある → ライト面だけ見る（ダークは別クラスが担当する）
 *  ・**無い** → そのクラスは両テーマで効くので、**ダーク面でも** AA を要求する
 *
 * なぜリテラル単位か（2026-08-17 実測）: ライトを直すために月カレンダーの曜日を
 * 500→700 にしたところ、そこには `dark:` が無かったのでダークで 2.49〜3.21:1 に落ちた。
 * ファイル単位で「どこかに dark: があるか」を見る作りだと、同じファイルの別の行の
 * `dark:` に助けられて**この事故を見逃す**（実際 MonthCalendar には別の dark: があった）。
 *
 * 残る限界: `const c = cond ? "text-rose-700 dark:text-rose-400" : ""` のように変数へ
 * 逃がしたクラスは、代入側のリテラルで判定する（＝そこに dark: を書けば通る）。
 * 変数を跨いだ打ち消し（後勝ちの上書き）までは静的には追えない。
 */
export function findLowContrastTextClasses(
  source: string,
  palette: Record<string, string>,
  filePath = ""
): TextColorFinding[] {
  const seen = new Map<string, TextColorFinding>();
  for (const lit of source.match(CLASS_LITERAL) ?? []) {
    if (!BASE_TEXT_CLASS.test(lit)) {
      BASE_TEXT_CLASS.lastIndex = 0;
      continue;
    }
    BASE_TEXT_CLASS.lastIndex = 0;
    const hasDarkVariant = /dark:text-/.test(lit);
    for (const m of lit.matchAll(BASE_TEXT_CLASS)) {
      const name = m[1];
      const cls = `text-${name}`;
      if (TEXT_COLOR_EXCEPTIONS.some((e) => e.cls === cls && filePath && sameFile(filePath, e.file)))
        continue;
      const hex = palette[name];
      if (!hex) continue; // 色見本に無い＝判定できない（黙って通す方が誤報より良い）

      const light = worstAgainst(hex, LIGHT_SURFACES);
      if (light.worst < AA_NORMAL && !seen.has(`${cls}|light`))
        seen.set(`${cls}|light`, {
          cls,
          hex,
          worst: Math.round(light.worst * 100) / 100,
          surface: light.surface,
          theme: "light",
        });

      if (hasDarkVariant) continue; // ダーク面は dark: 付きのクラスが担当する
      const darkS = worstAgainst(hex, DARK_SURFACES);
      if (darkS.worst < AA_NORMAL && !seen.has(`${cls}|dark`))
        seen.set(`${cls}|dark`, {
          cls,
          hex,
          worst: Math.round(darkS.worst * 100) / 100,
          surface: darkS.surface,
          theme: "dark",
        });
    }
  }
  return [...seen.values()];
}
