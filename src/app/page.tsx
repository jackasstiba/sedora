import Link from "next/link";
import { FilterBar } from "@/components/FilterBar";
import { ItemCard } from "@/components/ItemCard";
import { LoadMore } from "@/components/LoadMore";
import { getGenres, getItems, getStats, groupItemsByDate } from "@/lib/items";
import { getMonthsWithItems, monthLabel } from "@/lib/seo";

export const dynamic = "force-dynamic";

// 初期表示件数。全件（約800件・画像数百枚）を一度に描画するとHTML/RSCが数MBに
// 膨らみ初回表示が重いため、まずこの件数だけ描画し「もっと見る」で継ぎ足す。
const PAGE_SIZE = 120;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    genre?: string;
    q?: string;
    status?: string;
    when?: string;
    dated?: string;
    show?: string;
  }>;
}) {
  const params = await searchParams;
  const genre = params.genre ?? "";
  const query = params.q ?? "";
  // 表示件数（?show）。不正値は既定に丸め、下限は PAGE_SIZE。
  const parsedShow = Number.parseInt(params.show ?? "", 10);
  const show =
    Number.isFinite(parsedShow) && parsedShow > 0
      ? Math.max(PAGE_SIZE, parsedShow)
      : PAGE_SIZE;
  const status =
    params.status === "reserve" ||
    params.status === "lottery" ||
    params.status === "release" ||
    params.status === "now"
      ? params.status
      : undefined;
  const when = params.when === "week" || params.when === "month" ? params.when : undefined;
  const datedOnly = params.dated === "1";

  const [genres, items, stats, months] = await Promise.all([
    getGenres(),
    getItems({ genre: genre || undefined, query: query || undefined, status, when, datedOnly }),
    getStats(),
    getMonthsWithItems(),
  ]);

  // 初期表示は先頭 show 件だけ描画し、残りは「もっと見る」で継ぎ足す（ペイロード軽量化）。
  const visibleItems = items.slice(0, show);
  const remaining = items.length - visibleItems.length;

  // 常に発売日で並べ、日付見出し（今日/明日/今週/それ以降/日付未定）でグループ化する。
  const groups = groupItemsByDate(visibleItems);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-3xl">
          レアレーダー
        </h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          フィギュア・トレカ・スニーカー・一番くじ・コラボグッズなどの、予約開始・発売・抽選の予定。
        </p>
        <p className="mt-2 text-xs text-neutral-400">
          掲載 {stats.total} 件
          {stats.lastUpdated && (
            <>
              {" ・ "}最終更新 {new Date(stats.lastUpdated).toLocaleString("ja-JP")}
            </>
          )}
        </p>
      </header>

      <div className="mb-6">
        <FilterBar
          genres={genres}
          activeGenre={genre}
          activeQuery={query}
          activeStatus={status ?? ""}
          activeWhen={when ?? ""}
          activeDatedOnly={datedOnly}
        />
      </div>

      {items.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-neutral-500">該当する商品が見つかりませんでした。</p>
          <Link
            href="/"
            className="mt-4 inline-block rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition hover:border-rose-400 hover:text-rose-600 dark:border-neutral-700 dark:text-neutral-200"
          >
            絞り込みをリセット
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map((g) => (
            <section key={g.label}>
              <h2 className="mb-3 flex items-baseline gap-2 text-lg font-bold text-neutral-900 dark:text-neutral-50">
                {g.label}
                <span className="text-sm font-normal text-neutral-400">{g.items.length}</span>
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {g.items.map((item) => (
                  <ItemCard key={item.id} item={item} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {remaining > 0 && (
        <LoadMore
          activeGenre={genre}
          activeQuery={query}
          activeStatus={status ?? ""}
          activeWhen={when ?? ""}
          activeDatedOnly={datedOnly}
          nextShow={show + PAGE_SIZE}
          remaining={remaining}
        />
      )}

      <nav className="mt-12 border-t border-neutral-200 pt-6 dark:border-neutral-800">
        <p className="mb-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
          ジャンルから探す
        </p>
        <div className="mb-6 flex flex-wrap gap-2">
          {genres.map(({ genre: g }) => (
            <Link
              key={g}
              href={`/genre/${encodeURIComponent(g)}`}
              className="rounded-full border border-neutral-300 bg-white px-3 py-1 text-sm text-neutral-700 hover:border-rose-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
            >
              {g}
            </Link>
          ))}
        </div>

        {months.length > 0 && (
          <>
            <p className="mb-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
              発売月から探す
            </p>
            <div className="flex flex-wrap gap-2">
              {months.map((m) => (
                <Link
                  key={m}
                  href={`/release/${m}`}
                  prefetch={false}
                  className="rounded-full border border-neutral-300 bg-white px-3 py-1 text-sm text-neutral-700 hover:border-rose-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
                >
                  {monthLabel(m)}
                </Link>
              ))}
            </div>
          </>
        )}
      </nav>
    </main>
  );
}
