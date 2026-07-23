import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ItemCard } from "@/components/ItemCard";
import { getItemsByMonth, getMonthsWithItems, isValidMonth, monthLabel } from "@/lib/seo";

export const dynamic = "force-dynamic";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "";

type Props = { params: Promise<{ month: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { month } = await params;
  if (!isValidMonth(month)) return { title: "見つかりませんでした | レアレーダー" };
  const label = monthLabel(month);
  const title = `${label}発売・予約のレア・限定アイテム一覧 | レアレーダー`;
  const description =
    `${label}に発売・予約開始・抽選されるフィギュア・トレカ・スニーカー・一番くじ・コラボグッズなど` +
    `レア・限定アイテムの予定を日付順にまとめています。`;
  return {
    title,
    description,
    alternates: SITE ? { canonical: `${SITE}/release/${month}` } : undefined,
    openGraph: { title, description, type: "website" },
  };
}

export default async function MonthPage({ params }: Props) {
  const { month } = await params;
  if (!isValidMonth(month)) notFound();

  const [items, months] = await Promise.all([getItemsByMonth(month), getMonthsWithItems()]);
  if (items.length === 0) notFound();

  const label = monthLabel(month);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "レアレーダー", item: SITE || undefined },
      { "@type": "ListItem", position: 2, name: label },
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
        {label}
      </nav>

      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
          {label}発売・予約のレア・限定アイテム
        </h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          {label}に発売・予約開始・抽選される予定を日付順にまとめています（{items.length}件）。
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {items.map((item) => (
          <ItemCard key={item.id} item={item} />
        ))}
      </div>

      <nav className="mt-10 border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <p className="mb-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
          月別で見る
        </p>
        <div className="flex flex-wrap gap-2">
          {months
            .filter((m) => m !== month)
            .map((m) => (
              <a
                key={m}
                href={`/release/${m}`}
                className="rounded-full border border-neutral-300 bg-white px-3 py-1 text-sm text-neutral-700 hover:border-rose-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
              >
                {monthLabel(m)}
              </a>
            ))}
        </div>
      </nav>
    </main>
  );
}
