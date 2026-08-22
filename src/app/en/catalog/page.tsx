import type { Metadata } from "next";
import Link from "next/link";
import { ItemCard, type Item } from "@/components/ItemCard";
import { toCardItem } from "@/lib/cardItem";
import { getEnCatalogItems } from "@/lib/items";
import { oldestSeenAt, seenOnStoreEn } from "@/lib/scope";
import { EN_CATALOG_STORES, enCatalogPath } from "@/lib/enCatalog";
import { EN_CATALOG_PREVIEW } from "@/lib/pages";

// EN専用カタログのハブ（Phase 3b/3b'）。**日本語版には存在しないページ**＝
// /en/catalog 配下だけが scope="en" の行を出す。
//
// なぜこのページがあるか（[[Projects/sedori_radar_en]] Phase 3）:
// 日本の読者にとっての希少性は**時間**（逃すと買えない）だが、海外の読者にとっては**地理**
// （日本の店にしか無い）。公式ストアに普通に並んでいる在庫品は日本語面では価値が無いので
// 載せていないが、海外からはそれ自体が探し物になる。
//
// **何を約束するか**（[[UIラベルは裏取り済みのみ約束]]）:
//  ・約束するのは「この日、公式ストアの一覧にこの商品があった」という**過去の観測**だけ。
//  ・在庫があること／海外に送れること／代行が扱えることは**約束しない**（確かめられない）。
//  ・だから "In stock" とも "Available" とも書かない。書くのは "Still listed … as of <日付>"。
//
// **店名を出してよい根拠**は src/lib/enCatalog.ts（全て一次情報の公式ストア＝収集元非公開の対象外）。
export const revalidate = 900;

export const metadata: Metadata = {
  title: "From Japan's official stores | Hatsukore",
  description:
    "Japan-only merchandise that is still listed on official Japanese online stores — not new releases, but hard to find from outside Japan.",
  alternates: { canonical: "/en/catalog" },
};

export default async function CatalogHubEn() {
  // 店ごとに「先頭 EN_CATALOG_PREVIEW 件」と実数を出す。件数は**表示に使う配列の長さ**から
  // 出す（groupBy の生件数だと dedupeItems の分だけリンク先とズレて、数字が嘘になる）。
  const sections = [];
  for (const store of EN_CATALOG_STORES) {
    const rows = await getEnCatalogItems(store.source);
    if (!rows.length) continue;
    sections.push({
      store,
      total: rows.length,
      seenAt: oldestSeenAt(rows),
      preview: rows.slice(0, EN_CATALOG_PREVIEW).map(toCardItem) as Item[],
    });
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
      <nav className="mb-4 text-xs text-neutral-600 dark:text-neutral-400">
        <Link href="/en" className="hover:underline">
          Hatsukore
        </Link>
        {" / From Japan's official stores"}
      </nav>

      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-3xl">
          From Japan&apos;s official stores
        </h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Merchandise that is not a new release, but was still listed on an official Japanese
          online store at our last check. These items rarely reach shops outside Japan, so they
          are easy to miss even when nobody is racing for them.
        </p>
        <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
          Stock can sell out at any time and we do not track it — always confirm on the store
          page. These stores ship within Japan only; overseas collectors usually order through a
          proxy service.{" "}
          <a
            href="/en/how-to-buy"
            className="font-semibold text-rose-600 hover:underline dark:text-rose-400"
          >
            How to buy from Japan →
          </a>
        </p>
        <p className="mt-3 text-xs text-neutral-600 dark:text-neutral-400">
          Looking for upcoming pre-orders, releases and lottery deadlines instead?{" "}
          <Link href="/en" className="font-semibold text-rose-600 hover:underline dark:text-rose-400">
            See the drop schedule →
          </Link>
        </p>
      </header>

      <div className="flex flex-col gap-10">
        {sections.map(({ store, total, seenAt, preview }) => (
          <section key={store.slug}>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-50">
                <Link href={enCatalogPath(store.slug)} className="hover:underline">
                  {store.name}
                </Link>
              </h2>
              <Link
                href={enCatalogPath(store.slug)}
                className="text-sm font-semibold text-rose-600 hover:underline dark:text-rose-400"
              >
                Browse all {total} items →
              </Link>
            </div>
            <p className="mb-3 text-xs text-neutral-600 dark:text-neutral-400">
              {store.blurb}
              {seenAt && <> · Still listed as of {seenOnStoreEn(seenAt)} (JST)</>}
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {preview.map((item) => (
                <ItemCard key={item.id} item={item} locale="en" />
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
