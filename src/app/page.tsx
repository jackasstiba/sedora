import { Suspense } from "react";
import { FilterBar } from "@/components/FilterBar";
import { ItemCard } from "@/components/ItemCard";
import { getGenres, getItems, getStats } from "@/lib/items";
import { getMonthsWithItems, monthLabel } from "@/lib/seo";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    genre?: string;
    q?: string;
    sort?: string;
    status?: string;
    when?: string;
  }>;
}) {
  const params = await searchParams;
  const genre = params.genre ?? "";
  const query = params.q ?? "";
  const sort = params.sort === "recent" ? "recent" : "date";
  const status =
    params.status === "reserve" || params.status === "lottery" || params.status === "release"
      ? params.status
      : undefined;
  const when = params.when === "week" || params.when === "month" ? params.when : undefined;

  const [genres, items, stats, months] = await Promise.all([
    getGenres(),
    getItems({ genre: genre || undefined, query: query || undefined, sort, status, when }),
    getStats(),
    getMonthsWithItems(),
  ]);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-3xl">
          レアレーダー
        </h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          フィギュア・トレカ・スニーカー・プラモなど、レア・限定アイテムの予約開始・発売・抽選スケジュールを毎日まとめてお届け。
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
        <Suspense fallback={<div className="h-24" />}>
          <FilterBar
            genres={genres}
            activeGenre={genre}
            activeSort={sort}
            activeQuery={query}
            activeStatus={status ?? ""}
            activeWhen={when ?? ""}
          />
        </Suspense>
      </div>

      {items.length === 0 ? (
        <p className="py-16 text-center text-neutral-500">該当する商品が見つかりませんでした。</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </div>
      )}

      <nav className="mt-12 border-t border-neutral-200 pt-6 dark:border-neutral-800">
        <p className="mb-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
          ジャンルから探す
        </p>
        <div className="mb-6 flex flex-wrap gap-2">
          {genres.map(({ genre: g }) => (
            <a
              key={g}
              href={`/genre/${encodeURIComponent(g)}`}
              className="rounded-full border border-neutral-300 bg-white px-3 py-1 text-sm text-neutral-700 hover:border-rose-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
            >
              {g}
            </a>
          ))}
        </div>

        {months.length > 0 && (
          <>
            <p className="mb-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
              発売月から探す
            </p>
            <div className="flex flex-wrap gap-2">
              {months.map((m) => (
                <a
                  key={m}
                  href={`/release/${m}`}
                  className="rounded-full border border-neutral-300 bg-white px-3 py-1 text-sm text-neutral-700 hover:border-rose-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
                >
                  {monthLabel(m)}
                </a>
              ))}
            </div>
          </>
        )}
      </nav>

      <footer className="mt-8 border-t border-neutral-200 pt-4 text-xs text-neutral-400 dark:border-neutral-800">
        情報は各配信元サイトから自動収集したものです。予約・購入は各リンク先の公式・販売ページをご確認ください。
      </footer>
    </main>
  );
}
