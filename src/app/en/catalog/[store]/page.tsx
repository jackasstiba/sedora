import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ItemBrowser } from "@/components/ItemBrowser";
import { type Item } from "@/components/ItemCard";
import { toCardItem } from "@/lib/cardItem";
import { type FilterValues } from "@/components/FilterBar";
import { getEnCatalogItems } from "@/lib/items";
import { oldestSeenAt, seenOnStoreEn } from "@/lib/scope";
import { EN_CATALOG_STORES, enCatalogPath, enCatalogStoreBySlug } from "@/lib/enCatalog";
import { genreLabel } from "@/lib/i18n";

// 公式ストア1店ぶんの EN専用カタログ（Phase 3b'）。
//
// 店ごとに分けた理由は src/lib/enCatalog.ts のコメント（4店を1ページに集めると約6,000件）。
// **約束の強さはハブと同一**: 出すのは「この日、店の一覧にこの商品があった」という過去の
// 観測だけで、在庫の継続・海外発送の可否・入手容易さは約束しない。
export const revalidate = 900;

export function generateStaticParams() {
  return EN_CATALOG_STORES.map((s) => ({ store: s.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ store: string }>;
}): Promise<Metadata> {
  const store = enCatalogStoreBySlug((await params).store);
  if (!store) return {};
  return {
    title: `${store.name} — still in stock | Hatsukore`,
    description: `Japan-only merchandise still listed on ${store.name} at our last check. ${store.blurb}`,
    alternates: { canonical: enCatalogPath(store.slug) },
  };
}

const PAGE_SIZE = 120;

export default async function CatalogStoreEn({ params }: { params: Promise<{ store: string }> }) {
  const store = enCatalogStoreBySlug((await params).store);
  if (!store) notFound();

  const rows = await getEnCatalogItems(store.source);
  if (rows.length === 0) notFound(); // 中身が0件のページを作らない（薄いページを自分から出さない）

  const items: Item[] = rows.map(toCardItem);
  // 全行に等しく当てはまる（＝嘘にならない）のは**最も古い**確認時刻。
  const seenAt = oldestSeenAt(rows);

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
        {" / "}
        <Link href="/en/catalog" className="hover:underline">
          From Japan&apos;s official stores
        </Link>
        {` / ${store.name}`}
      </nav>

      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-3xl">
          {store.name}
        </h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          {store.blurb} Below are items that are not new releases, but were still listed on the
          store at our last check.
        </p>
        <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
          {/* 「Listed: N items」は audit:page が描画枚数＋残り件数と突合する（変えるなら検査側も）。 */}
          Listed: {items.length} items
          {seenAt && <> · Still listed on the store as of {seenOnStoreEn(seenAt)} (JST)</>}
        </p>
        <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
          Stock can sell out at any time and we do not track it — always confirm on the store
          page. This store ships within Japan only; overseas collectors usually order through a
          proxy service.{" "}
          <a
            href="/en/how-to-buy"
            className="font-semibold text-rose-600 hover:underline dark:text-rose-400"
          >
            How to buy from Japan →
          </a>
        </p>
      </header>

      <ItemBrowser
        items={items}
        genres={genreCounts}
        initial={initial}
        initialShow={PAGE_SIZE}
        locale="en"
        catalog
        basePath={enCatalogPath(store.slug)}
      />

      <nav className="mt-12 border-t border-neutral-200 pt-6 dark:border-neutral-800">
        <p className="mb-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
          Browse by genre
        </p>
        <div className="mb-6 flex flex-wrap gap-2">
          {/* 同一ルート内の Link 遷移だと ItemBrowser のマウント時フィルタ復元が走らないので
              <a>（フルロード）にする（/en と同じ理由）。 */}
          {genreCounts.map(({ genre: g }) => (
            <a
              key={g}
              href={`${enCatalogPath(store.slug)}?genre=${encodeURIComponent(g)}`}
              className="rounded-full border border-neutral-300 bg-white px-3 py-1 text-sm text-neutral-700 hover:border-rose-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
            >
              {genreLabel(g, "en")}
            </a>
          ))}
        </div>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          <Link href="/en/catalog" className="font-semibold text-rose-600 hover:underline dark:text-rose-400">
            ← All official stores
          </Link>
        </p>
      </nav>
    </main>
  );
}
