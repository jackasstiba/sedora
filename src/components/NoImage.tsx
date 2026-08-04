// 画像なしカードの代替表示。Xミラー系など元記事に商品画像が無い
// （og:imageはブログの汎用バナーで使えない）ため、素の灰色「画像なし」だと
// 壊れて見える。ジャンル絵文字＋ジャンル名で「意図した」プレースホルダにする。
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

export function NoImage({ genre }: { genre: string }) {
  const emoji = GENRE_EMOJI[genre] ?? "📦";
  const tint = GENRE_TINT[genre] ?? GENRE_TINT["その他"];
  return (
    <div
      className={`flex h-full w-full flex-col items-center justify-center gap-1 bg-gradient-to-br ${tint} px-2 text-center`}
    >
      <span className="text-4xl opacity-80" aria-hidden>
        {emoji}
      </span>
      <span className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">{genre}</span>
    </div>
  );
}
