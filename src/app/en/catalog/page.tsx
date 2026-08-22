import type { Metadata } from "next";
import Link from "next/link";
import { ItemBrowser } from "@/components/ItemBrowser";
import { type Item } from "@/components/ItemCard";
import { toCardItem } from "@/lib/cardItem";
import { type FilterValues } from "@/components/FilterBar";
import { getEnCatalogItems } from "@/lib/items";
import { oldestSeenAt, seenOnStoreEn } from "@/lib/scope";
import { genreLabel } from "@/lib/i18n";

// EN専用カタログ（Phase 3b）。**日本語版には存在しないページ**＝ここだけが scope="en" の行を出す。
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
export const revalidate = 900;

export const metadata: Metadata = {
  title: "From Japan's official stores | Hatsukore",
  description:
    "Japan-only merchandise that is still listed on official Japanese online stores — not new releases, but hard to find from outside Japan.",
  alternates: { canonical: "/en/catalog" },
};

const PAGE_SIZE = 120;

export default async function CatalogEn() {
  const rows = await getEnCatalogItems();
  const items: Item[] = rows.map(toCardItem);
  // 「いつ確認したか」はページに1回だけ書く。全行に等しく当てはまる（＝嘘にならない）のは
  // **最も古い**確認時刻なので、そちらを採る。
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
        {" / From Japan's official stores"}
      </nav>

      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-3xl">
          From Japan&apos;s official stores
        </h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Merchandise that is not a new release, but was still listed on an official Japanese
          online store at our last check. These items rarely reach shops outside Japan, so they
          are easy to miss even when nobody is racing for them.
        </p>
        <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
          {/* 「Listed: N items」は audit:page が描画枚数＋残り件数と突合する（変えるなら検査側も）。 */}
          Listed: {items.length} items
          {seenAt && <> · Still listed on the store as of {seenOnStoreEn(seenAt)} (JST)</>}
        </p>
        {/* 何を約束していないかを、約束の隣に置く。 */}
        <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
          Stock can sell out at any time and we do not track it — always confirm on the store
          page. Most of these stores ship within Japan only; overseas collectors usually order
          through a proxy service.{" "}
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

      {/* catalog: 日付を持たない行なので、日付の見出しと種別/時期タブを出さない。
          basePath: 絞り込みURLの同期先（渡さないと /en に飛んで別ページの絞り込みになる）。 */}
      <ItemBrowser
        items={items}
        genres={genreCounts}
        initial={initial}
        initialShow={PAGE_SIZE}
        locale="en"
        catalog
        basePath="/en/catalog"
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
              href={`/en/catalog?genre=${encodeURIComponent(g)}`}
              className="rounded-full border border-neutral-300 bg-white px-3 py-1 text-sm text-neutral-700 hover:border-rose-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
            >
              {genreLabel(g, "en")}
            </a>
          ))}
        </div>
      </nav>
    </main>
  );
}
