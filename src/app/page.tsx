import Link from "next/link";
import { ItemBrowser } from "@/components/ItemBrowser";
import { type Item } from "@/components/ItemCard";
import { type FilterValues } from "@/components/FilterBar";
import { getItems, getStats } from "@/lib/items";
import { getMonthsWithItems, monthLabel } from "@/lib/seo";

export const dynamic = "force-dynamic";

// 「もっと見る」の初期表示件数（ItemBrowser 側と一致させる）。
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
  const status =
    params.status === "reserve" ||
    params.status === "lottery" ||
    params.status === "release" ||
    params.status === "now"
      ? params.status
      : "";
  const when = params.when === "week" || params.when === "month" ? params.when : "";
  const datedOnly = params.dated === "1";
  const parsedShow = Number.parseInt(params.show ?? "", 10);
  const initialShow =
    Number.isFinite(parsedShow) && parsedShow > 0 ? Math.max(PAGE_SIZE, parsedShow) : PAGE_SIZE;

  // 「今後の予定＋日付未定（過去は除外）」の全件を一度だけ取得し、以降の絞り込み・
  // ページングはブラウザ内で即時に行う（サーバー往復ゼロ＝フィルタが速い）。
  const [baseItems, stats, months] = await Promise.all([
    getItems({}),
    getStats(),
    getMonthsWithItems(),
  ]);

  // クライアントへ渡せるようシリアライズ（eventDate は ISO 文字列）。表示に使う分だけ。
  const items: Item[] = baseItems.map((it) => ({
    id: it.id,
    source: it.source,
    title: it.title,
    genre: it.genre,
    subGenre: it.subGenre,
    eventType: it.eventType,
    eventDate: it.eventDate ? it.eventDate.toISOString() : null,
    eventDateText: it.eventDateText,
    price: it.price,
    url: it.url,
    imageUrl: it.imageUrl,
    marketPriceText: it.marketPriceText,
  }));

  // ジャンル別件数（表示対象＝今後＋未定 のスコープで数える）。件数降順。
  const genreCounts = Object.entries(
    items.reduce<Record<string, number>>((m, it) => {
      m[it.genre] = (m[it.genre] ?? 0) + 1;
      return m;
    }, {})
  )
    .map(([g, count]) => ({ genre: g, count }))
    .sort((a, b) => b.count - a.count);

  const initial: FilterValues = { genre, query, status, when, datedOnly };

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

      <ItemBrowser items={items} genres={genreCounts} initial={initial} initialShow={initialShow} />

      <nav className="mt-12 border-t border-neutral-200 pt-6 dark:border-neutral-800">
        <p className="mb-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
          ジャンルから探す
        </p>
        <div className="mb-6 flex flex-wrap gap-2">
          {genreCounts.map(({ genre: g }) => (
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
