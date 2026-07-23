import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ItemCard } from "@/components/ItemCard";
import { getItemsByGenre, getGenreList } from "@/lib/seo";

export const dynamic = "force-dynamic";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "";

type Props = { params: Promise<{ genre: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { genre: raw } = await params;
  const genre = decodeURIComponent(raw);
  const title = `${genre}の予約・発売スケジュール一覧 | レアレーダー`;
  const description =
    `${genre}のレア・限定アイテムの予約開始・発売・抽選スケジュールを毎日自動でまとめて掲載。` +
    `${genre}の新作・新商品の発売日をいち早くチェックできます。`;
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

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "レアレーダー", item: SITE || undefined },
      { "@type": "ListItem", position: 2, name: genre },
    ],
  };

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <nav className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
        <a href="/" className="hover:underline">
          レアレーダー
        </a>
        {" ／ "}
        {genre}
      </nav>

      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
          {genre}の予約・発売スケジュール
        </h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          {genre}のレア・限定アイテムの予約開始・発売・抽選予定を、発売日が近い順にまとめています（{items.length}件）。
        </p>
      </header>

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
              <a
                key={g}
                href={`/genre/${encodeURIComponent(g)}`}
                className="rounded-full border border-neutral-300 bg-white px-3 py-1 text-sm text-neutral-700 hover:border-rose-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
              >
                {g}
              </a>
            ))}
        </div>
      </nav>
    </main>
  );
}
