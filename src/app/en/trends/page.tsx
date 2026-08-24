import type { Metadata } from "next";
import Link from "next/link";
import { ItemBrowser } from "@/components/ItemBrowser";
import { type Item } from "@/components/ItemCard";
import { toCardItem } from "@/lib/cardItem";
import { type FilterValues } from "@/components/FilterBar";
import { enCatalogPath } from "@/lib/enCatalog";
import { seenOnStoreEn } from "@/lib/scope";
import { nowInstant } from "@/lib/date";
import {
  EN_TRENDS_PATH,
  TRENDS_WINDOW_DAYS,
  countByStore,
  getTrendItems,
  getTrendsLastCheckedAt,
  trendWindow,
  trendsHeadlineEn,
  trendsIsStale,
} from "@/lib/trends";

// 「日本の公式ストアが今週なにを並べたか」。設計と約束の全部は src/lib/trends.ts の先頭。
//
// この面が言うのは**店自身が付けた公開日**（storeListedAt）だけで、人気・入手難度・新発売とは
// 言わない。窓の終わりも「今日」ではなく**最後にその店を見た時刻**にしてある＝巡回が止まれば
// 窓ごと過去にずれ、画面に "as of …" と出る（空白を今週の事実として語らないため）。
export const revalidate = 900;

export const metadata: Metadata = {
  title: "New this week from Japan's official stores | Hatsukore",
  description:
    "What Japan's official character-goods stores put up for sale in the last 7 days — hololive, Chiikawa, Nagano and mofusand, with the date each item went up.",
  alternates: { canonical: EN_TRENDS_PATH },
};

const PAGE_SIZE = 120;

export default async function TrendsEn() {
  const lastCheckedAt = await getTrendsLastCheckedAt();
  const win = trendWindow(lastCheckedAt);
  const rows = win ? await getTrendItems(win) : [];

  const items: Item[] = rows.map(toCardItem);
  // 店ごとの件数は**数だけ**を出す（どの商品がどの店か、は配信物に出さない）。
  // 店名を出してよいのは公式ストアだけ＝母集団は登録簿から導出している（src/lib/trends.ts）。
  const stores = countByStore(rows);
  const stale = win ? trendsIsStale(win, nowInstant()) : false;

  const genreCounts = Object.entries(
    items.reduce<Record<string, number>>((m, it) => {
      m[it.genre] = (m[it.genre] ?? 0) + 1;
      return m;
    }, {})
  )
    .map(([g, count]) => ({ genre: g, count }))
    .sort((a, b) => b.count - a.count);

  const initial: FilterValues = { genre: "", query: "", status: "", when: "", datedOnly: false };

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
      <nav className="mb-4 text-xs text-neutral-600 dark:text-neutral-400">
        <Link href="/en" className="hover:underline">
          Hatsukore
        </Link>
        {" / What went up this week"}
      </nav>

      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-3xl">
          New this week from Japan&apos;s official stores
        </h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Every item below went up for sale on a Japanese character-goods store in the last{" "}
          {TRENDS_WINDOW_DAYS} days. The date is the one the store itself published — not the day
          we found it.
        </p>

        {win && items.length > 0 ? (
          <>
            <p className="mt-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {trendsHeadlineEn(items.length, stores.length)}
            </p>
            <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
              {/* 窓は必ず両端を綴る。「今週」だけだと、巡回が止まった週も同じ言葉になる。 */}
              {seenOnStoreEn(win.from)} – {seenOnStoreEn(win.to)} (JST) · Last checked{" "}
              {seenOnStoreEn(win.to)}
            </p>
            {stale && (
              // 巡回が止まっている間もページは配信される。**黙って古い数字を今週の話にしない。**
              <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
                Heads up: we have not been able to check these stores since{" "}
                {seenOnStoreEn(win.to)}, so anything they listed after that date is not on this
                page yet.
              </p>
            )}
          </>
        ) : (
          // 0件を「今週は何も出なかった」と読ませない（見ていないだけかもしれない）。
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
            We do not have a recent enough check of these stores to show this week yet.{" "}
            <Link
              href="/en/catalog"
              className="font-semibold text-rose-600 hover:underline dark:text-rose-400"
            >
              Browse the full store catalog →
            </Link>
          </p>
        )}

        <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
          These stores ship within Japan only; overseas collectors usually order through a proxy
          service. Stock can sell out at any time and we do not track it.{" "}
          <a
            href="/en/how-to-buy"
            className="font-semibold text-rose-600 hover:underline dark:text-rose-400"
          >
            How to buy from Japan →
          </a>
        </p>
      </header>

      {stores.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
            Where they came from
          </h2>
          <ul className="flex flex-wrap gap-2">
            {stores.map(({ store, count }) => (
              <li key={store.source}>
                <Link
                  href={enCatalogPath(store.slug)}
                  className="inline-flex items-center gap-2 rounded-full border border-neutral-300 bg-white px-3 py-1 text-sm text-neutral-700 hover:border-rose-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
                >
                  <span>{store.name}</span>
                  <span className="font-semibold text-neutral-900 dark:text-neutral-50">{count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {items.length > 0 && (
        <ItemBrowser
          items={items}
          genres={genreCounts}
          initial={initial}
          initialShow={PAGE_SIZE}
          locale="en"
          catalog
          basePath={EN_TRENDS_PATH}
        />
      )}

      <nav className="mt-12 border-t border-neutral-200 pt-6 dark:border-neutral-800">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          <Link href="/en" className="font-semibold text-rose-600 hover:underline dark:text-rose-400">
            ← Upcoming pre-orders, releases and lottery drops
          </Link>
        </p>
      </nav>
    </main>
  );
}
