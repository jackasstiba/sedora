import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ItemCard } from "@/components/ItemCard";
import { getItemsByGenre, getGenreList } from "@/lib/seo";
import { getTcgTitleCounts } from "@/lib/tcg";

export const revalidate = 1800; // 30分ISRキャッシュ（表示高速化・Turso負荷減）

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "";

export async function generateStaticParams() {
  const genres = await getGenreList();
  return genres.map((genre) => ({ genre }));
}

type Props = { params: Promise<{ genre: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { genre: raw } = await params;
  const genre = decodeURIComponent(raw);
  const title = `${genre}の予約・発売スケジュール一覧 | ハツコレ`;
  const description = `${genre}の予約開始・発売・抽選の予定を、発売日が近い順に掲載。`;
  return {
    title,
    description,
    alternates: SITE ? { canonical: `${SITE}/genre/${encodeURIComponent(genre)}` } : undefined,
    openGraph: { title, description, type: "website" },
  };
}

export default async function GenrePage({ params }: Props) {
  const { genre: raw } = await params;
  const genre = decodeURIComponent(raw);

  const [items, allGenres] = await Promise.all([getItemsByGenre(genre), getGenreList()]);
  if (items.length === 0) notFound();

  // トレカは「カードゲーム別」ページ（/tcg/[title]）への導線を出す（競合と同じSEO構造）
  const tcgTitles = genre === "トレカ" ? await getTcgTitleCounts() : [];

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "ハツコレ", item: SITE || undefined },
      { "@type": "ListItem", position: 2, name: genre },
    ],
  };

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <nav className="mb-4 text-xs text-neutral-600 dark:text-neutral-400">
        <Link href="/" className="hover:underline">
          ハツコレ
        </Link>
        {" ／ "}
        {genre}
      </nav>

      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
          {genre}の予約・発売スケジュール
        </h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          発売日が近い順・{items.length}件
        </p>
      </header>

      {tcgTitles.length > 0 && (
        <nav className="mb-6" aria-label="カードゲーム別">
          <p className="mb-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
            カードゲーム別に見る
          </p>
          <div className="flex flex-wrap gap-2">
            {tcgTitles.map((c) => (
              <Link
                key={c.label}
                href={`/tcg/${encodeURIComponent(c.label)}`}
                className="rounded-full border border-neutral-300 bg-white px-3 py-1 text-sm text-neutral-700 hover:border-rose-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
              >
                {c.label}
                <span className="ml-1 text-xs text-neutral-600 dark:text-neutral-400">{c.count}</span>
              </Link>
            ))}
          </div>
        </nav>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {items.map((item) => (
          <ItemCard key={item.id} item={item} />
        ))}
      </div>

      <nav className="mt-10 border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <p className="mb-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
          他のジャンル
        </p>
        <div className="flex flex-wrap gap-2">
          {allGenres
            .filter((g) => g !== genre)
            .map((g) => (
              <Link
                key={g}
                href={`/genre/${encodeURIComponent(g)}`}
                className="rounded-full border border-neutral-300 bg-white px-3 py-1 text-sm text-neutral-700 hover:border-rose-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
              >
                {g}
              </Link>
            ))}
        </div>
      </nav>
    </main>
  );
}
