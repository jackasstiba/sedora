import { Suspense } from "react";
import { FilterBar } from "@/components/FilterBar";
import { ItemCard } from "@/components/ItemCard";
import { getGenres, getItems, getStats } from "@/lib/items";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ genre?: string; q?: string; sort?: string }>;
}) {
  const params = await searchParams;
  const genre = params.genre ?? "";
  const query = params.q ?? "";
  const sort = params.sort === "recent" ? "recent" : "date";

  const [genres, items, stats] = await Promise.all([
    getGenres(),
    getItems({ genre: genre || undefined, query: query || undefined, sort }),
    getStats(),
  ]);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-3xl">
          せどりレーダー
        </h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          レア・限定品の予約 / 発売 / 抽選情報をまとめて自動収集。せどり・転売の仕入れリサーチに。
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
          <FilterBar genres={genres} activeGenre={genre} activeSort={sort} activeQuery={query} />
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

      <footer className="mt-12 border-t border-neutral-200 pt-4 text-xs text-neutral-400 dark:border-neutral-800">
        情報は各配信元サイトから自動収集したものです。予約・購入は各リンク先の公式・販売ページをご確認ください。
      </footer>
    </main>
  );
}
