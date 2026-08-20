// 画像なしカードの代替表示。Xミラー/アグリ系は元記事に使える商品画像が無く
// （og:imageはブログ汎用バナー、本文画像は収集元CDN＝ソース露見/ホットリンクNG）、
// 素の灰色「画像なし」だと壊れて見える＝画像なしが結構ある問題への対処。
//
// title を渡すと「文字タイル」＝商品名を主役に見せる情報カバーにする（＝空きスペースに
// 実際の中身＝商品名を出して"意図した見た目"にする）。title 無し（詳細ページ等、別に
// 大見出しがある場面）は従来のジャンル絵文字＋ジャンル名の装飾プレースホルダにする。
// （収集元サイト名は非公開方針のため表示しない）
const GENRE_EMOJI: Record<string, string> = {
  フィギュア: "🧸",
  トレカ: "🃏",
  スニーカー: "👟",
  プラモ: "🤖",
  一番くじ: "🎯",
  コラボ: "🤝",
  ポケモン: "⚡",
  ゲーム: "🎮",
  "映像・音楽": "💿",
  "家電・ゲーム機": "🕹️",
  "酒・ウイスキー": "🥃",
  "ソフビ・アートトイ": "🎨",
  その他: "📦",
};

// ジャンルごとにほんのり色味を変えて単調さを避ける（淡い背景）。
const GENRE_TINT: Record<string, string> = {
  フィギュア: "from-rose-50 to-rose-100 dark:from-rose-950/30 dark:to-neutral-900",
  トレカ: "from-blue-50 to-blue-100 dark:from-blue-950/30 dark:to-neutral-900",
  スニーカー: "from-emerald-50 to-emerald-100 dark:from-emerald-950/30 dark:to-neutral-900",
  プラモ: "from-slate-50 to-slate-100 dark:from-slate-900/40 dark:to-neutral-900",
  一番くじ: "from-amber-50 to-amber-100 dark:from-amber-950/30 dark:to-neutral-900",
  コラボ: "from-fuchsia-50 to-fuchsia-100 dark:from-fuchsia-950/30 dark:to-neutral-900",
  ポケモン: "from-yellow-50 to-yellow-100 dark:from-yellow-950/30 dark:to-neutral-900",
  ゲーム: "from-violet-50 to-violet-100 dark:from-violet-950/30 dark:to-neutral-900",
  "映像・音楽": "from-cyan-50 to-cyan-100 dark:from-cyan-950/30 dark:to-neutral-900",
  "家電・ゲーム機": "from-sky-50 to-sky-100 dark:from-sky-950/30 dark:to-neutral-900",
  "酒・ウイスキー": "from-amber-50 to-orange-100 dark:from-amber-950/30 dark:to-neutral-900",
  "ソフビ・アートトイ": "from-pink-50 to-pink-100 dark:from-pink-950/30 dark:to-neutral-900",
  その他: "from-neutral-100 to-neutral-200 dark:from-neutral-800 dark:to-neutral-900",
};

export function NoImage({ genre, title, label }: { genre: string; title?: string; label?: string }) {
  const emoji = GENRE_EMOJI[genre] ?? "📦";
  const tint = GENRE_TINT[genre] ?? GENRE_TINT["その他"];
  // 英語版はジャンルの英語ラベルを渡す（絵文字・色のキーはJP語彙のまま）。
  const genreText = label ?? genre;

  // title あり＝文字タイル（商品名を主役に）。空きスペースに実情報を出して"意図した"見た目に。
  if (title) {
    return (
      <div
        className={`relative flex h-full w-full flex-col justify-between overflow-hidden bg-gradient-to-br ${tint} p-3`}
      >
        <span
          className="pointer-events-none absolute -bottom-4 -right-3 select-none text-8xl opacity-10"
          aria-hidden
        >
          {emoji}
        </span>
        <span className="z-10 inline-flex w-fit items-center gap-1 rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-semibold text-neutral-600 shadow-sm dark:bg-black/30 dark:text-neutral-300">
          <span aria-hidden>{emoji}</span>
          {genreText}
        </span>
        <p className="z-10 line-clamp-4 text-sm font-bold leading-snug text-neutral-800 dark:text-neutral-100">
          {title}
        </p>
      </div>
    );
  }

  // title なし＝従来の装飾プレースホルダ（詳細ページ等、別に大見出しがある場面）。
  return (
    <div
      className={`flex h-full w-full flex-col items-center justify-center gap-1 bg-gradient-to-br ${tint} px-2 text-center`}
    >
      <span className="text-4xl opacity-80" aria-hidden>
        {emoji}
      </span>
      <span className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">{genreText}</span>
    </div>
  );
}
