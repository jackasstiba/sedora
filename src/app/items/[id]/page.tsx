import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ItemCard } from "@/components/ItemCard";
import { NoImage } from "@/components/NoImage";
import { OutboundLink } from "@/components/OutboundLink";
import { sourceLabel } from "@/lib/items";
import { computeMargin, formatDiff, formatPct, formatPriceDisplay } from "@/lib/margin";
import { hasSearchableTitle, isOfficialUrl, rakutenSearchUrl } from "@/lib/outbound";
import { getItemById, getRelatedItems } from "@/lib/seo";
import { formatLong } from "@/lib/date";
import { stripSourceLabel } from "@/lib/title";

export const revalidate = 1800; // 30分ISRキャッシュ（表示高速化・Turso負荷減）

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "";

function formatDate(date: Date | null): string | null {
  return date ? formatLong(date) : null;
}

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const item = await getItemById(Number(id));
  if (!item) return { title: "見つかりませんでした | ハツコレ" };

  const dateStr = formatDate(item.eventDate) ?? item.eventDateText ?? "";
  const cleanTitle = stripSourceLabel(item.title);
  const title = `${cleanTitle} | ハツコレ`;
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

  const related = await getRelatedItems(item);
  const dateLabel = formatDate(item.eventDate) ?? item.eventDateText;
  const margin = computeMargin(item.price, item.marketPrice);
  // 情報元由来の定型ラベル（snkrdunkの「｜抽選/販売/定価情報」等）は表示・構造化データから除去。
  const displayTitle = stripSourceLabel(item.title);

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Product",
        name: displayTitle,
        image: item.imageUrl ?? undefined,
        category: item.genre,
        description: `${displayTitle}の${item.eventType}情報（${item.genre}）`,
        ...(SITE ? { url: `${SITE}/items/${item.id}` } : {}),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "ハツコレ", item: SITE || undefined },
          {
            "@type": "ListItem",
            position: 2,
            name: item.genre,
            item: SITE ? `${SITE}/genre/${encodeURIComponent(item.genre)}` : undefined,
          },
          { "@type": "ListItem", position: 3, name: displayTitle },
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
        <Link href="/" className="hover:underline">
          ハツコレ
        </Link>
        {" ／ "}
        <Link href={`/genre/${encodeURIComponent(item.genre)}`} className="hover:underline">
          {item.genre}
        </Link>
      </nav>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-800">
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.imageUrl} alt={item.title} className="h-full w-full object-cover" />
          ) : (
            <NoImage genre={item.genre} source={item.source} />
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-rose-600 px-2 py-0.5 font-semibold text-white">
              {item.eventType}
            </span>
            <Link
              href={`/genre/${encodeURIComponent(item.genre)}`}
              className="rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-700 hover:underline dark:bg-neutral-800 dark:text-neutral-200"
            >
              {item.genre}
            </Link>
            {item.subGenre && item.subGenre !== item.genre && (
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
                {item.subGenre}
              </span>
            )}
          </div>

          <h1 className="text-xl font-bold leading-snug text-neutral-900 dark:text-neutral-50">
            {displayTitle}
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
                <dd className="text-neutral-800 dark:text-neutral-100">{formatPriceDisplay(item.price)}</dd>
              </>
            )}
            {item.marketPriceText && (
              <>
                <dt className="text-neutral-500 dark:text-neutral-400">相場</dt>
                <dd className="text-neutral-800 dark:text-neutral-100">
                  <span className="font-semibold text-amber-700 dark:text-amber-400">
                    {item.marketPriceText}
                  </span>
                  {item.marketUrl && (
                    <OutboundLink
                      href={item.marketUrl}
                      kind="market"
                      source={item.source}
                      itemId={item.id}
                      className="ml-2 text-xs text-neutral-500 underline hover:text-rose-600 dark:text-neutral-400"
                    >
                      駿河屋で見る
                    </OutboundLink>
                  )}
                </dd>
              </>
            )}
            {margin && (
              <>
                <dt className="text-neutral-500 dark:text-neutral-400">定価比</dt>
                <dd>
                  <span
                    className={`font-semibold ${
                      margin.isPremium
                        ? "text-rose-600 dark:text-rose-400"
                        : "text-neutral-700 dark:text-neutral-200"
                    }`}
                  >
                    {formatPct(margin.pct)}（{formatDiff(margin.diff)}）
                  </span>
                  <span className="ml-2 text-xs text-neutral-500 dark:text-neutral-400">
                    定価 ¥{margin.teika.toLocaleString("ja-JP")} → 相場 ¥
                    {margin.market.toLocaleString("ja-JP")}
                  </span>
                  {margin.isPremium && (
                    <span className="ml-1 text-xs text-rose-500">（プレ値）</span>
                  )}
                </dd>
              </>
            )}
            <dt className="text-neutral-500 dark:text-neutral-400">配信元</dt>
            <dd className="text-neutral-800 dark:text-neutral-100">{sourceLabel(item.source)}</dd>
          </dl>

          {/* コラボ記事本文から抽出した注目賞品（抽選/ランダムの高額品＝せどりの本命）。 */}
          {item.highlights && (
            <div
              className={`rounded-lg px-3 py-2 text-sm ${
                item.hasLottery
                  ? "bg-purple-50 text-purple-900 dark:bg-purple-950/40 dark:text-purple-200"
                  : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
              }`}
            >
              <span className="font-semibold">{item.hasLottery ? "🎯 注目賞品" : "🛍 注目グッズ"}</span>
              <span className="ml-1">{item.highlights.replace(/^[^：]+：/, "")}</span>
              {item.hasLottery && (
                <p className="mt-0.5 text-xs text-purple-700/80 dark:text-purple-300/80">
                  抽選・ランダムで当たる賞品を含みます。転売相場が付きやすいので要チェック。
                </p>
              )}
            </div>
          )}

          {/* 情報元 / 購入導線。item.url の実態(公式 or まとめ・告知)に合わせてラベルを出し分ける。 */}
          <div className="mt-2 flex flex-col gap-2">
            <OutboundLink
              href={item.url}
              kind={isOfficialUrl(item.source) ? "official" : "source"}
              source={item.source}
              itemId={item.id}
              className="inline-flex items-center justify-center rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700"
            >
              {isOfficialUrl(item.source)
                ? "公式ページで見る →"
                : `情報元（${sourceLabel(item.source)}）で見る →`}
            </OutboundLink>
            {/* コラボ記事から辿った一次情報（公式キャンペーン/ストア）。何が売られるかの原典。 */}
            {item.officialUrl && (
              <OutboundLink
                href={item.officialUrl}
                kind="official_secondary"
                source={item.source}
                itemId={item.id}
                className="inline-flex items-center justify-center rounded-lg border border-rose-600 px-4 py-2.5 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 dark:hover:bg-rose-950"
              >
                公式（一次情報）で販売内容を見る →
              </OutboundLink>
            )}
            {/* 実際に購入できる場所への導線（商品名で楽天市場を検索）。将来アフィリンクに差し替え。 */}
            {hasSearchableTitle(item.source) && (
              <OutboundLink
                href={rakutenSearchUrl(item.title)}
                kind="rakuten"
                source={item.source}
                itemId={item.id}
                className="inline-flex items-center justify-center rounded-lg border border-rose-600 px-4 py-2.5 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 dark:hover:bg-rose-950"
              >
                楽天で探す →
              </OutboundLink>
            )}
          </div>
          <p className="text-xs text-neutral-400">
            ※ 情報元は各所のまとめ・告知ページを含みます。予約・購入は各リンク先で最新の在庫・価格・抽選条件をご確認ください。
          </p>
        </div>
      </div>

      {related.series.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-lg font-bold text-neutral-900 dark:text-neutral-50">
            「{related.seriesLabel}」の関連アイテム
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {related.series.map((r) => (
              <ItemCard key={r.id} item={r} />
            ))}
          </div>
        </section>
      )}

      {related.genre.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-lg font-bold text-neutral-900 dark:text-neutral-50">
            {item.genre}の予約・発売予定
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {related.genre.map((r) => (
              <ItemCard key={r.id} item={r} />
            ))}
          </div>
          <p className="mt-4 text-sm">
            <Link
              href={`/genre/${encodeURIComponent(item.genre)}`}
              className="text-rose-600 hover:underline dark:text-rose-400"
            >
              {item.genre}の一覧をすべて見る →
            </Link>
          </p>
        </section>
      )}
    </main>
  );
}
