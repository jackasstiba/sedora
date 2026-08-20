import { ItemBrowser } from "@/components/ItemBrowser";
import { type Item } from "@/components/ItemCard";
import { toCardItem } from "@/lib/cardItem";
import { type FilterValues } from "@/components/FilterBar";
import { getItems, getLastUpdated } from "@/lib/items";
import { formatDateTimeJst } from "@/lib/date";
import { genreLabel } from "@/lib/i18n";

// 英語版トップ。データ・掲載スコープ・並び順は日本語トップ（(ja)/page.tsx）と完全に同じで、
// 表示層だけが英語。キャッシュ戦略も同じ（ISR 15分・絞り込みURLはクライアント側で復元）。
export const revalidate = 900;

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "";

// hreflang は**双方向**でないと無効（[[Projects/sedori_radar_en]] 注意点§1）。
// 日本語側は (ja)/page.tsx の metadata が /en を指す。
export const metadata = {
  alternates: {
    canonical: "/en",
    // 各言語版は**自分自身も含めて**全言語を列挙する（Googleのhreflang仕様）。
    languages: { ja: "/", en: "/en", "x-default": "/" },
  },
};

const PAGE_SIZE = 120;

export default async function HomeEn() {
  const [baseItems, lastUpdated] = await Promise.all([getItems({}), getLastUpdated()]);

  // クライアントへ渡す形は toCardItem が決める（収集元が割れる url / imageUrl / source は
  // 型として持てない＝英語版のペイロードにも出ない。非公開方針はここで固定される）。
  const items: Item[] = baseItems.map(toCardItem);

  const genreCounts = Object.entries(
    items.reduce<Record<string, number>>((m, it) => {
      m[it.genre] = (m[it.genre] ?? 0) + 1;
      return m;
    }, {})
  )
    .map(([g, count]) => ({ genre: g, count }))
    .sort((a, b) => b.count - a.count);

  const initial: FilterValues = { genre: "", query: "", status: "", when: "", datedOnly: false };

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Hatsukore",
    description:
      "Upcoming Japanese pre-orders, releases and lottery drops for figures, trading cards, sneakers, Ichiban Kuji and collab goods — sorted by date.",
    url: SITE ? `${SITE}/en` : undefined,
    inLanguage: "en",
  };

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-3xl">
          Hatsukore
        </h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Upcoming Japanese pre-orders, releases and lottery drops — figures, trading cards,
          sneakers, Ichiban Kuji, collab goods and more.
        </p>
        <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
          {/* 「Listed: N items」は audit:page が描画枚数と突合する（変えるなら検査側も一緒に）。 */}
          Listed: {items.length} items
          {lastUpdated && <> · Last updated {formatDateTimeJst(lastUpdated)} JST</>}
          {/* 締切が商品のサイトなのでTZを常に明示（[[Projects/sedori_radar_en]] 注意点§2）。 */}
          {" · All dates are Japan time (JST)"}
        </p>
        {/* 入手経路タグの定義。約束するのは「導線の性質」だけで、可用性・海外購入の可否は
            約束しない（裏取りできないため）。無タグ＝未確認、を明示する。 */}
        <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
          🛒 Online (JP) = ordered or entered on an official Japanese online store or draw
          platform. Most of them ship within Japan only; overseas collectors commonly order
          through proxy/forwarding services. Items without the tag are unverified — many are
          in-store only.
        </p>
      </header>

      <ItemBrowser items={items} genres={genreCounts} initial={initial} initialShow={PAGE_SIZE} locale="en" />

      <nav className="mt-12 border-t border-neutral-200 pt-6 dark:border-neutral-800">
        <p className="mb-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
          Browse by genre
        </p>
        <div className="mb-6 flex flex-wrap gap-2">
          {/* 英語版はジャンル別の静的ページを持たない（v1）。絞り込みURLへ送る。
              <a>（フルロード）を使う: 同一ルート内の Link 遷移だと ItemBrowser の
              マウント時フィルタ復元が走らず、URLだけ変わって絞り込まれない。 */}
          {genreCounts.map(({ genre: g }) => (
            <a
              key={g}
              href={`/en?genre=${encodeURIComponent(g)}`}
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
