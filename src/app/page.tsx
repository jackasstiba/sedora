import Link from "next/link";
import { ItemBrowser } from "@/components/ItemBrowser";
import { type Item } from "@/components/ItemCard";
import { type FilterValues } from "@/components/FilterBar";
import { getItems, getLastUpdated } from "@/lib/items";
import { formatDateTimeJst } from "@/lib/date";
import { getMonthsWithItems, monthLabel } from "@/lib/seo";

// トップは静的プリレンダー＋ISR（15分）でCDNキャッシュから配信する。
// force-dynamic だと毎リクエストで Turso 全件クエリ＋全件シリアライズが走り、TTFB が重く
// Turso の読み取り枠も消費する。データ更新は1日2回程度なので 15分の再生成で十分新しい。
// 注意: この改変版 Next では searchParams を await するとページが動的レンダリングに落ちて
// ISR が効かなくなるため、初期フィルタURL（?genre= 等）の復元は ItemBrowser（クライアント）が
// マウント時に window.location.search から行う。トップの静的HTMLは常に全件（未絞り込み）で、
// これは共有URLがSEO上の重複ページにならない点でも望ましい。
export const revalidate = 900;

// 「もっと見る」の初期表示件数（ItemBrowser 側と一致させる）。
const PAGE_SIZE = 120;

export default async function Home() {
  // 「今後の予定＋日付未定（過去は除外）」の全件を一度だけ取得し、以降の絞り込み・
  // ページングはブラウザ内で即時に行う（サーバー往復ゼロ＝フィルタが速い）。
  const [baseItems, lastUpdated, months] = await Promise.all([
    getItems({}),
    getLastUpdated(),
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
    marketPrice: it.marketPrice,
    marketPriceText: it.marketPriceText,
    highlights: it.highlights,
    hasLottery: it.hasLottery,
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

  // 初期状態は常に「未絞り込み・先頭ページ」。URLの絞り込みは ItemBrowser が
  // マウント時にクライアント側で復元する（このページを静的キャッシュ可能に保つため）。
  const initial: FilterValues = { genre: "", query: "", status: "", when: "", datedOnly: false };

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
          {/* 掲載件数は重複解消後の表示リスト（items.length）と一致させる。 */}
          掲載 {items.length} 件
          {lastUpdated && (
            <>
              {" ・ "}最終更新 {formatDateTimeJst(lastUpdated)}
            </>
          )}
        </p>
      </header>

      <ItemBrowser items={items} genres={genreCounts} initial={initial} initialShow={PAGE_SIZE} />

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
