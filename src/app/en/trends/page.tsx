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
import { TRENDS_LONG_WINDOW_DAYS, getLongWindowSummary, pct } from "@/lib/trendsFranchise";

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
  // 4週間ビュー（作品別に「初めて見た」件数）。物差しが週次ビューと違うので混ぜず、別の節に出す。
  const long = await getLongWindowSummary();

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

      {long && long.franchises.length > 0 && (
        // 「日本の企業がいまどの作品に賭けているか」。言えるのは「こちらの巡回で初めて見た件数」まで
        //（人気・売れ行き・発売とは言わない）。観測できた日数を必ず添える＝空白を事実として語らない。
        <section className="mb-8 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-50">
            What Japanese companies are making right now — {TRENDS_LONG_WINDOW_DAYS}-day view
          </h2>
          <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
            Franchises ranked by how many listings (pre-orders, releases, lotteries, store items)
            first appeared in our daily crawl between {seenOnStoreEn(long.from)} and{" "}
            {seenOnStoreEn(long.to)} (JST) — counted on {long.observedDays} of {long.calendarDays}{" "}
            days; anything that appeared and disappeared between checks is not counted. A listing
            can belong to more than one franchise. This is what companies put money behind, not what
            sold.
          </p>
          <ol className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {long.franchises.map((f, i) => (
              <li key={f.key} className="flex items-baseline justify-between gap-3 border-b border-neutral-100 py-1 dark:border-neutral-800">
                <span className="text-neutral-800 dark:text-neutral-200">
                  <span className="mr-2 tabular-nums text-neutral-600 dark:text-neutral-400">{i + 1}.</span>
                  {f.name}
                </span>
                <span className="tabular-nums text-neutral-900 dark:text-neutral-50">
                  <span className="font-semibold">{f.firstSeen}</span>
                  <span className="ml-1 text-xs text-neutral-600 dark:text-neutral-400">new · {f.current} tracked</span>
                </span>
              </li>
            ))}
          </ol>
          {long.lotteryShare && (
            <p className="mt-3 text-xs text-neutral-600 dark:text-neutral-400">
              Lottery-type listings (raffles, kuji) were {pct(long.lotteryShare.from)} of everything we
              track on {seenOnStoreEn(long.from)} and {pct(long.lotteryShare.to)} on{" "}
              {seenOnStoreEn(long.to)}.
            </p>
          )}
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
