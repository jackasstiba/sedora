import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ItemCard } from "@/components/ItemCard";
import { NoImage } from "@/components/NoImage";
import { OutboundLink } from "@/components/OutboundLink";
import { computeMargin, formatDiff, formatPct, formatPriceDisplay } from "@/lib/margin";
import { hasSearchableTitle, isOfficialUrl, rakutenSearchUrl } from "@/lib/outbound";
import { getItemById, getRelatedItems } from "@/lib/seo";
import { formatLong } from "@/lib/date";
import { displaySubGenre, stripSourceLabel } from "@/lib/title";
import { isHotPrize, parseKujiLineup, parsePrizesJson } from "@/lib/prizes";
import { parseStoresJson } from "@/lib/stores";

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
  // 一番くじの各等賞。構造化JSON（画像＋賞ごと相場）があればギャラリー表示、
  // 無ければ highlights の畳み込み文字列からリスト展開（旧データ後方互換）。
  const prizeGallery = parsePrizesJson(item.prizes);
  const lineup = prizeGallery ? null : parseKujiLineup(item.highlights);
  // 賞ギャラリーの見せ方を賞データから決める（ソース非依存）。
  // 一番くじ＝等級賞(A賞/ラストワン賞)＝labelが「賞」で終わる。raffle-kuji＝等級なしで
  // labelは当選確率(例「0.5%」)＝先頭ほど低確率＝高額の本命。二次相場(resale)は付く賞のみ。
  const prizesGraded = prizeGallery?.some((p) => /賞$/.test(p.label)) ?? false;
  const prizesHaveResale = prizeGallery?.some((p) => !!p.resaleText) ?? false;
  // 家電・ゲーム機など「複数の小売が同時に抽選/予約応募中」の商品の受付中ストア一覧（公式直リンク）。
  const storeList = parseStoresJson(item.stores);

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
            <NoImage genre={item.genre} />
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
            {displaySubGenre(item.subGenre) && displaySubGenre(item.subGenre) !== item.genre && (
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
                {displaySubGenre(item.subGenre)}
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
          </dl>

          {/* 構造化された各賞ギャラリー（画像＋相場）はグリッド下の専用セクションで表示する。
              ここは gallery が無い場合のみ＝旧データのリスト or コラボ由来の1行要約。 */}
          {prizeGallery ? null : lineup ? (
            <div className="rounded-lg bg-purple-50 px-3 py-2.5 text-sm dark:bg-purple-950/40">
              <p className="font-semibold text-purple-900 dark:text-purple-200">
                🎯 各賞ラインナップ（全{lineup.length}種・くじ）
              </p>
              <ul className="mt-1.5 flex flex-col gap-1">
                {lineup.map((p) => (
                  <li key={p.label} className="flex items-start gap-2 leading-snug">
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-bold ${
                        isHotPrize(p.label)
                          ? "bg-rose-600 text-white"
                          : "bg-purple-200 text-purple-900 dark:bg-purple-900/60 dark:text-purple-100"
                      }`}
                    >
                      {p.label}
                    </span>
                    <span className="text-neutral-800 dark:text-neutral-100">{p.name}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-xs text-purple-700/80 dark:text-purple-300/80">
                くじ（抽選）で当たる賞品です。A賞・ラストワン賞は二次相場が付きやすいので要チェック。
              </p>
            </div>
          ) : storeList ? (
            /* 家電・ゲーム機は下部の「受付中ストア」節で公式リンクごと詳しく出すので、ここは畳む。 */
            null
          ) : (
            /* コラボ記事本文から抽出した注目賞品（抽選/ランダムの高額品＝せどりの本命）。 */
            item.highlights && (
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
            )
          )}

          {/* 公式・一次情報・購入導線のみを出す。
              ※ 収集元（まとめ/Xミラー/カレンダー等）のURLは非公開方針のため item.url を直リンクしない。
                 公式ページを指すソースだけ「公式ページで見る」を出し、それ以外は officialUrl（記事から辿った
                 一次情報）と商品名検索の購入導線に寄せる。 */}
          <div className="mt-2 flex flex-col gap-2">
            {isOfficialUrl(item.source) && (
              <OutboundLink
                href={item.url}
                kind="official"
                source={item.source}
                itemId={item.id}
                className="inline-flex items-center justify-center rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700"
              >
                公式ページで見る →
              </OutboundLink>
            )}
            {/* 記事から辿った一次情報（公式キャンペーン/ストア）。何が売られるかの原典。 */}
            {item.officialUrl && (
              <OutboundLink
                href={item.officialUrl}
                kind="official_secondary"
                source={item.source}
                itemId={item.id}
                className="inline-flex items-center justify-center rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700"
              >
                公式で販売内容を見る →
              </OutboundLink>
            )}
            {/* 実際に購入できる場所への導線（商品名で楽天市場を検索）。将来アフィリンクに差し替え。
                収集元URLを出さない代わりに、公式リンクを持たない商品でも行き止まりにしない導線。 */}
            {(hasSearchableTitle(item.source) || (!isOfficialUrl(item.source) && !item.officialUrl)) && (
              <OutboundLink
                href={rakutenSearchUrl(hasSearchableTitle(item.source) ? item.title : displayTitle)}
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
            ※ 予約・購入は各リンク先で最新の在庫・価格・抽選条件をご確認ください。
          </p>
        </div>
      </div>

      {/* 家電・ゲーム機の「今まさに受付中の各小売（公式）」一覧。抽選/予約応募の一次ソースへ直リンク。 */}
      {storeList && (
        <section className="mt-10">
          <h2 className="mb-1 text-lg font-bold text-neutral-900 dark:text-neutral-50">
            🎯 抽選・予約 受付中ストア（公式 {storeList.length}店）
          </h2>
          <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
            現在応募・予約を受付中のストアです。応募条件（購入履歴・会員登録など）・在庫・締切は各公式ページでご確認ください。
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {storeList.map((s) => (
              <li
                key={s.name + s.url}
                className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
              >
                <div className="min-w-0">
                  <div className="truncate font-semibold text-neutral-900 dark:text-neutral-100">{s.name}</div>
                  {(s.form || s.when) && (
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
                      {s.form && (
                        <span className="rounded bg-purple-100 px-1.5 py-0.5 font-medium text-purple-800 dark:bg-purple-900/40 dark:text-purple-200">
                          {s.form}
                        </span>
                      )}
                      {s.when && <span className="font-semibold text-rose-600 dark:text-rose-400">{s.when}</span>}
                    </div>
                  )}
                  {s.note && (
                    <p className="mt-1 text-xs leading-snug text-neutral-500 dark:text-neutral-400">
                      条件: {s.note}
                    </p>
                  )}
                </div>
                <OutboundLink
                  href={s.url}
                  kind="official"
                  source={item.source}
                  itemId={item.id}
                  className="shrink-0 rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-rose-700"
                >
                  応募ページ →
                </OutboundLink>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 各等賞ギャラリー（賞画像＋賞ごとの二次相場）。一番くじの“何が当たるか”を最も濃く見せる面。 */}
      {prizeGallery && (
        <section className="mt-10">
          <h2 className="mb-1 text-lg font-bold text-neutral-900 dark:text-neutral-50">
            🎯 {prizesGraded ? "各賞ラインナップ" : "賞品ラインナップ"}（全{prizeGallery.length}種・くじ）
          </h2>
          <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
            くじ（抽選）で当たる賞品です。
            {prizesGraded
              ? "A賞・ラストワン賞は二次相場が付きやすい本命。"
              : "当選確率が低い賞（左上のバッジ）ほど本数が少なく高額の本命。"}
            {prizesHaveResale &&
              "相場は駿河屋（中古バラ売り）の参考値で、発売済みの賞にのみ表示されます（メルカリはこれより高い傾向）。"}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {prizeGallery.map((p, i) => {
              // 注目枠（rose）＝等級ありは A賞/ラストワン賞、raffleは先頭＝最低確率の本命。
              const hot = prizesGraded ? isHotPrize(p.label) : i === 0;
              return (
              <div
                key={`${p.label}-${i}`}
                className={`flex flex-col overflow-hidden rounded-xl border bg-white shadow-sm dark:bg-neutral-900 ${
                  hot
                    ? "border-rose-300 dark:border-rose-800"
                    : "border-neutral-200 dark:border-neutral-800"
                }`}
              >
                <div className="relative aspect-square w-full overflow-hidden bg-neutral-100 dark:bg-neutral-800">
                  {p.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.image}
                      alt={`${p.label} ${p.name}`}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="grid h-full w-full place-items-center text-3xl text-neutral-300 dark:text-neutral-600">
                      🎁
                    </div>
                  )}
                  <span
                    className={`absolute left-2 top-2 rounded px-1.5 py-0.5 text-xs font-bold ${
                      hot
                        ? "bg-rose-600 text-white"
                        : "bg-purple-200 text-purple-900 dark:bg-purple-900/70 dark:text-purple-100"
                    }`}
                  >
                    {p.label}
                  </span>
                </div>
                <div className="flex flex-1 flex-col gap-1 p-2.5">
                  <p className="line-clamp-3 flex-1 text-sm leading-snug text-neutral-800 dark:text-neutral-100">
                    {p.name}
                  </p>
                  {p.resaleText &&
                    (p.resaleUrl ? (
                      <OutboundLink
                        href={p.resaleUrl}
                        kind="market"
                        source={item.source}
                        itemId={item.id}
                        className="inline-flex w-fit items-center rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-300"
                      >
                        相場 {p.resaleText} →
                      </OutboundLink>
                    ) : (
                      <span className="inline-flex w-fit items-center rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                        相場 {p.resaleText}
                      </span>
                    ))}
                </div>
              </div>
              );
            })}
          </div>
        </section>
      )}

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
