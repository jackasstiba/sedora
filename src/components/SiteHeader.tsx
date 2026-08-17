import Link from "next/link";
import { getGenreList } from "@/lib/seo";

// 全ページ共通のヘッダー。SEO流入で深いページ（ジャンル/商品/月）に着地した
// ユーザーが、サイトの正体を認識し・他ジャンルへ回遊できるようにするための恒久ナビ。
export async function SiteHeader() {
  const genres = await getGenreList();

  return (
    <header className="sticky top-0 z-20 border-b border-rose-100/70 bg-[var(--background)]/85 backdrop-blur dark:border-neutral-800">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-2.5">
        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="ハツコレ トップへ">
          {/* ブランドマーク：柿色グラデの角丸バッジ＋“新しい発見”を表す4点スパークル。 */}
          <span
            aria-hidden
            className="grid h-7 w-7 place-items-center rounded-[9px] bg-gradient-to-br from-rose-400 to-rose-600 shadow-sm shadow-rose-600/20"
          >
            <svg viewBox="0 0 32 32" className="h-4 w-4" fill="#fff" aria-hidden>
              <path d="M16 3.5c1 7.6 3.9 10.5 11.5 11.5C19.9 16 17 18.9 16 26.5 15 18.9 12.1 16 4.5 15 12.1 14 15 11.1 16 3.5Z" />
            </svg>
          </span>
          <span className="text-[17px] font-extrabold tracking-tight text-neutral-900 dark:text-neutral-50">
            ハツコレ
          </span>
        </Link>

        {/* ※「相場」ピル（/premium への導線）は 2026-08-10 に撤去。理由は lib/seo.ts の
            getPremiumItems のコメント（相場の出どころが実態と食い違っていたため保留）。 */}

        {/* 抽選まとめビューへの固定導線（当選＝定価入手＝せどりの本命。抽選色＝紫）。 */}
        <Link
          href="/lottery"
          className="shrink-0 rounded-full bg-purple-600 px-2.5 py-1 text-sm font-semibold text-white transition hover:bg-purple-700"
        >
          抽選
        </Link>

        {/* ジャンルの横スクロールナビ（モバイルでも指でスワイプ可） */}
        <nav
          aria-label="ジャンル"
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {genres.map((g) => (
            <Link
              key={g}
              href={`/genre/${encodeURIComponent(g)}`}
              className="rounded-full px-2.5 py-1 text-sm text-neutral-600 transition hover:bg-rose-50 hover:text-rose-600 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-rose-400"
            >
              {g}
            </Link>
          ))}
        </nav>

        <a
          href="/feed.xml"
          title="RSSで新着を購読"
          className="shrink-0 rounded-md p-1.5 text-neutral-600 transition hover:bg-rose-50 hover:text-rose-600 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-rose-400"
        >
          <span className="sr-only">RSSで新着を購読</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="h-4 w-4"
            aria-hidden
          >
            <circle cx="6.18" cy="17.82" r="2.18" />
            <path d="M4 4.44v2.83c7.03 0 12.73 5.7 12.73 12.73h2.83C19.56 11.4 12.6 4.44 4 4.44z" />
            <path d="M4 10.1v2.83c3.9 0 7.07 3.17 7.07 7.07h2.83c0-5.47-4.43-9.9-9.9-9.9z" />
          </svg>
        </a>
      </div>
    </header>
  );
}
