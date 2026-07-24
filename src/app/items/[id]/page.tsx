import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ItemCard } from "@/components/ItemCard";
import { sourceLabel } from "@/lib/items";
import { getItemById, getRelatedItems } from "@/lib/seo";
import { formatLong } from "@/lib/date";

export const revalidate = 1800; // 30分ISRキャッシュ（表示高速化・Turso負荷減）

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "";

function formatDate(date: Date | null): string | null {
  return date ? formatLong(date) : null;
}

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const item = await getItemById(Number(id));
  if (!item) return { title: "見つかりませんでした | レアレーダー" };

  const dateStr = formatDate(item.eventDate) ?? item.eventDateText ?? "";
  const title = `${item.title} | レアレーダー`;
  // 事実だけを簡潔に（宣伝文句は入れない）
  const description = [
    dateStr ? `${item.eventType}日: ${dateStr}` : null,
    item.price ? `価格: ${item.price}` : null,
    `ジャンル: ${item.genre}`,
    `情報元: ${sourceLabel(item.source)}`,
  ]
    .filter(Boolean)
    .join(" ／ ");

  return {
    title,
    description,
    alternates: SITE ? { canonical: `${SITE}/items/${item.id}` } : undefined,
    openGraph: {
      title,
      description,
      type: "article",
      images: item.imageUrl ? [{ url: item.imageUrl }] : undefined,
    },
  };
}

export default async function ItemPage({ params }: Props) {
  const { id } = await params;
  const item = await getItemById(Number(id));
  if (!item) notFound();

  const related = await getRelatedItems(item.genre, item.id);
  const dateLabel = formatDate(item.eventDate) ?? item.eventDateText;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Product",
        name: item.title,
        image: item.imageUrl ?? undefined,
        category: item.genre,
        description: `${item.title}の${item.eventType}情報（${item.genre}）`,
        ...(SITE ? { url: `${SITE}/items/${item.id}` } : {}),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "レアレーダー", item: SITE || undefined },
          {
            "@type": "ListItem",
            position: 2,
            name: item.genre,
            item: SITE ? `${SITE}/genre/${encodeURIComponent(item.genre)}` : undefined,
          },
          { "@type": "ListItem", position: 3, name: item.title },
        ],
      },
    ],
  };

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <nav className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
        <a href="/" className="hover:underline">
          レアレーダー
        </a>
        {" ／ "}
        <a href={`/genre/${encodeURIComponent(item.genre)}`} className="hover:underline">
          {item.genre}
        </a>
      </nav>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-800">
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.imageUrl} alt={item.title} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-neutral-400">
              画像なし
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-rose-600 px-2 py-0.5 font-semibold text-white">
              {item.eventType}
            </span>
            <a
              href={`/genre/${encodeURIComponent(item.genre)}`}
              className="rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-700 hover:underline dark:bg-neutral-800 dark:text-neutral-200"
            >
              {item.genre}
            </a>
            {item.subGenre && item.subGenre !== item.genre && (
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
                {item.subGenre}
              </span>
            )}
          </div>

          <h1 className="text-xl font-bold leading-snug text-neutral-900 dark:text-neutral-50">
            {item.title}
          </h1>

          <dl className="grid grid-cols-[5rem_1fr] gap-y-1 text-sm">
            {dateLabel && (
              <>
                <dt className="text-neutral-500 dark:text-neutral-400">{item.eventType}日</dt>
                <dd className="font-semibold text-rose-600 dark:text-rose-400">{dateLabel}</dd>
              </>
            )}
            {item.price && (
              <>
                <dt className="text-neutral-500 dark:text-neutral-400">価格</dt>
                <dd className="text-neutral-800 dark:text-neutral-100">{item.price}</dd>
              </>
            )}
            <dt className="text-neutral-500 dark:text-neutral-400">配信元</dt>
            <dd className="text-neutral-800 dark:text-neutral-100">{sourceLabel(item.source)}</dd>
          </dl>

          {/* 外部の公式・販売ページへ（将来アフィリエイトリンクを差し込む箇所） */}
          <a
            href={item.url}
            target="_blank"
            rel="nofollow noopener noreferrer"
            className="mt-2 inline-flex items-center justify-center rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700"
          >
            公式・販売ページで見る →
          </a>
          <p className="text-xs text-neutral-400">
            ※ 予約・購入は各リンク先の公式・販売ページをご確認ください。
          </p>
        </div>
      </div>

      {related.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-lg font-bold text-neutral-900 dark:text-neutral-50">
            {item.genre}の予約・発売予定
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {related.map((r) => (
              <ItemCard key={r.id} item={r} />
            ))}
          </div>
          <p className="mt-4 text-sm">
            <a
              href={`/genre/${encodeURIComponent(item.genre)}`}
              className="text-rose-600 hover:underline dark:text-rose-400"
            >
              {item.genre}の一覧をすべて見る →
            </a>
          </p>
        </section>
      )}
    </main>
  );
}
