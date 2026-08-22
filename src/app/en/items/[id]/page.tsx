import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ItemCard } from "@/components/ItemCard";
import { toCardItem } from "@/lib/cardItem";
import { NoImage } from "@/components/NoImage";
import { OutboundLink } from "@/components/OutboundLink";
import { formatPriceDisplay } from "@/lib/margin";
import { hasSearchableTitle, isOfficialUrl, officialUrlLabelEn, rakutenSearchUrl } from "@/lib/outbound";
import { getItemById, getRelatedItems, getSaleUnits } from "@/lib/seo";
import { eventDateHeading } from "@/lib/itemFilter";
import { countdown, displayEventType, eventDateLabelEn, eventPeriodText, isEventPast, isMonthPrecision, pastNotice, todayJst } from "@/lib/date";
import { PastNoticeBoxEn } from "@/components/PastNotice";
import { cleanListTitle, displaySubGenre } from "@/lib/title";
import { isHotPrize, parseKujiLineup, parsePrizesJson } from "@/lib/prizes";
import { absoluteImageUrl, proxiedImageUrl } from "@/lib/imageProxy";
import {
  COLLAB_MECHANISM_EN,
  countdownLabelEn,
  dateHeadingEn,
  eventTypeLabel,
  genreLabel,
  goodsLabel,
  hasGoodsLabelEn,
  pastNoticeEn,
} from "@/lib/i18n";
import { parseHighlights } from "@/lib/collabHighlights";
import { ONLINE_TAG_EN, isOnlineItem } from "@/lib/channel";
// 計測に収集元を載せるが、名前そのものは送らない（符号化してから渡す）。
import { sourceCode } from "@/lib/sourceCode";
import {
  groupStoresByLabel,
  parseStoresJson,
  preferredStoreUrl,
  splitStoresByDeadline,
  storeSectionCopyEn,
  storeWhenLabelEn,
} from "@/lib/stores";

// 英語版の商品詳細。データ・掲載判定・「約束の強さ」の規則は (ja)/items/[id] と同一で、
// 表示の枠だけが英語。**商品名・賞名・収集元の文言（highlights / eventDateText / when /
// salesChannel）は訳さない**＝訳して精度・断定を足さない（lang="ja" を付けて原文のまま出す）。
export const revalidate = 1800; // 30分ISR（日本語詳細と同じ）

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const item = await getItemById(Number(id));
  if (!item) return { title: "Not found | Hatsukore" };

  const cleanTitle = cleanListTitle(item.source, item.title);
  const past = isEventPast(item.eventDate, item.eventDateText, todayJst());
  const lotteryCtx = { source: item.source, eventDate: item.eventDate, stores: item.stores };
  const heading = dateHeadingEn(eventDateHeading(item.eventType, item.eventDateText, past, lotteryCtx));
  const dateEn = eventDateLabelEn(item.eventDate, item.eventDateText);
  // 日付が英語書式で作れた（＝eventDate がある）時だけ見出し＋日付を挟む。無い時に
  // 見出しだけ挟むと「| Event date |」と日付の無い約束が浮く（実測 #3517）。
  const datePart = item.eventDate && dateEn ? ` | ${heading} ${dateEn}` : "";
  // <title> は「原文の商品名＋英語の事実」。商品名を英訳しない（検索語は公式表記で確立している）。
  const title = `${cleanTitle}${datePart} | Hatsukore`;
  const description = [
    // 説明文も同じ規則: 英語書式の日付が作れた時だけ「見出し: 日付 (JST)」を書く
    // （日本語の原文テキストに (JST) を付けると意味の無い接尾になる）。
    item.eventDate && dateEn ? `${heading}: ${dateEn} (JST)` : null,
    item.price ? `Price: ${item.price}` : null,
    item.hasLottery ? "Lottery/random prizes" : null,
    `Japanese ${genreLabel(item.genre, "en").toLowerCase()}`,
    "Upcoming Japan release info on Hatsukore.",
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    title,
    description,
    alternates: {
      canonical: `/en/items/${item.id}`,
      // hreflang は日本語詳細と**双方向**（片方向は無効）。x-default は日本語側。
      languages: {
        ja: `/items/${item.id}`,
        en: `/en/items/${item.id}`,
        "x-default": `/items/${item.id}`,
      },
    },
    openGraph: {
      title,
      description,
      type: "article",
      images: absoluteImageUrl(SITE, item.id, item.imageUrl)
        ? [{ url: absoluteImageUrl(SITE, item.id, item.imageUrl)! }]
        : undefined,
    },
  };
}

export default async function ItemPageEn({ params }: Props) {
  const { id } = await params;
  const item = await getItemById(Number(id));
  if (!item) notFound();

  const saleUnits = await getSaleUnits(item);
  const related = await getRelatedItems(item, 12, saleUnits.map((u) => u.id));
  const dateLabel = eventDateLabelEn(item.eventDate, item.eventDateText);
  // 日付が eventDate から作れた＝英語書式。作れず原文（日本語）のまま＝lang="ja" を付ける。
  const dateLabelIsJa = !item.eventDate && !!dateLabel;
  // 月精度のものはカウントダウンを出さない（合成した月初への秒読みになる＝JAと同じ規則）。
  const cd = isMonthPrecision(item.eventDateText) ? null : countdown(item.eventDate);
  const periodText = eventPeriodText(item.eventDate, item.eventDateText);
  const displayTitle = cleanListTitle(item.source, item.title);
  const showRakuten =
    hasSearchableTitle(item.source) || (!isOfficialUrl(item.source) && !item.officialUrl);
  const prizeGallery = parsePrizesJson(item.prizes);
  const lineup = prizeGallery ? null : parseKujiLineup(item.highlights);
  // コラボ要約（決まった書式）を構造に戻す。書式が違えば null＝原文のまま出す。
  const collab = parseHighlights(item.highlights);
  const prizesGraded = prizeGallery?.some((p) => /賞$/.test(p.label)) ?? false;
  const storeList = parseStoresJson(item.stores);
  const storeSplit = storeList ? splitStoresByDeadline(storeList, todayJst()) : null;
  const openStores = storeSplit?.open ?? [];
  const closedStoreCount = storeSplit?.closed.length ?? 0;
  const storeGroups = groupStoresByLabel(openStores);
  const officialHref = (openStores.length ? preferredStoreUrl(openStores) : null) ?? item.url;
  const lotteryCtx = { source: item.source, eventDate: item.eventDate, stores: item.stores };
  const past = isEventPast(item.eventDate, item.eventDateText, todayJst());
  const heading = dateHeadingEn(eventDateHeading(item.eventType, item.eventDateText, past, lotteryCtx));
  const storeCopy = storeSectionCopyEn(item.source);
  // 入手経路タグ（裏取り済みの組だけ。約束の定義はトップの脚注と /en/how-to-buy）。
  const online = isOnlineItem({ source: item.source, url: item.url, officialUrl: item.officialUrl });
  // バッジは日本語の語彙で決めて表示だけ英語（対応表に無い語は日本語のまま＝断定を足さない）。
  const eventLabelJa = displayEventType(item.eventType, item.eventDate, item.eventDateText, todayJst());
  const eventLabelEn = eventTypeLabel(eventLabelJa, "en");
  // 期限が過ぎた行は「過去のものだ」と画面で言う。判定(kind)は日本語版と**同じ純関数**を
  // 使い、英語にするのは文言だけ＝翻訳で断定の強さが変わらないようにする。
  const pastInfo = pastNotice(item, todayJst());
  const pastEn = pastInfo ? pastNoticeEn(pastInfo.kind) : null;
  // 受付が終わった行の主導線を赤（＝今すぐ動ける色）で出さない。リンク自体は残す。
  const primaryBtn =
    pastInfo?.kind === "ended"
      ? "inline-flex items-center justify-center rounded-lg bg-neutral-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-800 dark:bg-neutral-600 dark:hover:bg-neutral-500"
      : "inline-flex items-center justify-center rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700";

  // 構造化データはパンくずのみ（英語版v1）。Product/Offer は日本語詳細が正規に申告している。
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Hatsukore", item: SITE ? `${SITE}/en` : undefined },
      {
        "@type": "ListItem",
        position: 2,
        name: genreLabel(item.genre, "en"),
        item: SITE ? `${SITE}/en?genre=${encodeURIComponent(item.genre)}` : undefined,
      },
      { "@type": "ListItem", position: 3, name: displayTitle },
    ],
  };

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <nav className="mb-4 text-xs text-neutral-600 dark:text-neutral-400">
        <Link href="/en" className="hover:underline">
          Hatsukore
        </Link>
        {" / "}
        {/* ENはジャンル静的ページを持たない（v1）ので絞り込みURLへ。<a>＝フルロード
            （同一ルート内Link遷移だとItemBrowserの復元effectが走らない＝トップと同じ理由）。 */}
        <a href={`/en?genre=${encodeURIComponent(item.genre)}`} className="hover:underline">
          {genreLabel(item.genre, "en")}
        </a>
        {" / "}
        {/* この商品の日本語版（hreflangの人間版）。 */}
        <Link href={`/items/${item.id}`} className="hover:underline" lang="ja">
          日本語
        </Link>
      </nav>

      {pastInfo && pastEn && (
        <PastNoticeBoxEn
          kind={pastInfo.kind}
          headline={pastEn.headline}
          detail={pastEn.detail}
          dateLabel={dateLabel}
        />
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-800">
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={proxiedImageUrl(item.id, item.imageUrl)!} alt={item.title} className="h-full w-full object-cover" />
          ) : (
            <NoImage genre={item.genre} />
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-rose-600 px-2 py-0.5 font-semibold text-white">
              {eventLabelEn}
            </span>
            <a
              href={`/en?genre=${encodeURIComponent(item.genre)}`}
              className="rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-700 hover:underline dark:bg-neutral-800 dark:text-neutral-200"
            >
              {genreLabel(item.genre, "en")}
            </a>
            {online && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                {ONLINE_TAG_EN}
              </span>
            )}
            {displaySubGenre(item.subGenre) && displaySubGenre(item.subGenre) !== item.genre && (
              <span lang="ja" className="rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
                {displaySubGenre(item.subGenre)}
              </span>
            )}
          </div>

          {/* 商品名は日本語の固有名なので原文のまま（訳すと検索語ともファンの語彙とも合わなくなる）。 */}
          <h1 lang="ja" className="text-xl font-bold leading-snug text-neutral-900 dark:text-neutral-50">
            {displayTitle}
          </h1>

          <dl className="grid grid-cols-[7.5rem_1fr] gap-y-1 text-sm">
            {dateLabel && (
              <>
                <dt className="text-neutral-600 dark:text-neutral-400">{heading}</dt>
                <dd className="font-semibold text-rose-600 dark:text-rose-400">
                  <span lang={dateLabelIsJa ? "ja" : undefined}>{dateLabel}</span>
                  {cd && (
                    <span
                      className={`ml-2 rounded-full px-2 py-0.5 text-xs font-bold align-middle ${
                        cd.tone === "urgent"
                          ? "bg-rose-600 text-white"
                          : cd.tone === "soon"
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200"
                            : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                      }`}
                    >
                      {cd.tone === "urgent" ? "🔥 " : ""}
                      {countdownLabelEn(cd.days)}
                    </span>
                  )}
                </dd>
              </>
            )}
            {/* 受付期間・締切・時刻。収集元の文言をそのまま出す＝精度を足さない（JAと同じ）。 */}
            {periodText && (
              <>
                <dt className="text-neutral-600 dark:text-neutral-400">Times (JST)</dt>
                <dd lang="ja" className="text-neutral-800 dark:text-neutral-100">{periodText}</dd>
              </>
            )}
            {item.price && (
              <>
                <dt className="text-neutral-600 dark:text-neutral-400">Price (JPY)</dt>
                <dd lang="ja" className="text-neutral-800 dark:text-neutral-100">{formatPriceDisplay(item.price)}</dd>
              </>
            )}
            {item.salesChannel && (
              <>
                <dt className="text-neutral-600 dark:text-neutral-400">Stores (JP)</dt>
                <dd lang="ja" className="text-neutral-800 dark:text-neutral-100">{item.salesChannel}</dd>
              </>
            )}
          </dl>

          {prizeGallery ? null : lineup ? (
            <div className="rounded-lg bg-purple-50 px-3 py-2.5 text-sm dark:bg-purple-950/40">
              <p className="font-semibold text-purple-900 dark:text-purple-200">
                🎯 Prize lineup ({lineup.length} tiers · kuji)
              </p>
              <ul className="mt-1.5 flex flex-col gap-1">
                {lineup.map((p) => (
                  <li key={p.label} className="flex items-start gap-2 leading-snug">
                    <span
                      lang="ja"
                      className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-bold ${
                        isHotPrize(p.label)
                          ? "bg-rose-600 text-white"
                          : "bg-purple-200 text-purple-900 dark:bg-purple-900/60 dark:text-purple-100"
                      }`}
                    >
                      {p.label}
                    </span>
                    <span lang="ja" className="text-neutral-800 dark:text-neutral-100">{p.name}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-xs text-purple-700/80 dark:text-purple-300/80">
                Prizes are won by drawing a kuji (lottery ticket). Top tiers are limited in number
                and cannot be chosen.
              </p>
            </div>
          ) : storeList ? null : (
            item.highlights && (
              <div
                className={`rounded-lg px-3 py-2 text-sm ${
                  item.hasLottery
                    ? "bg-purple-50 text-purple-900 dark:bg-purple-950/40 dark:text-purple-200"
                    : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
                }`}
              >
                <span className="font-semibold">{item.hasLottery ? "🎯 Featured prizes" : "🛍 Merch lineup"}</span>
                {/* コラボの要約は**書式が決まっている**（src/lib/collabHighlights.ts が組み立てと
                    読み解きの唯一の定義）ので、英語の枠に組み直して出す。訳すのはグッズの
                    **種別名**だけで、対応表に無い語は日本語のまま（lang="ja"）＝断定を足さない。
                    読み解けない書式（他ソースの highlights）は従来どおり原文のまま出す。 */}
                {collab ? (
                  <div className="mt-1 flex flex-col gap-1.5">
                    {collab.mechanism && (
                      <p className="text-xs font-medium">
                        {COLLAB_MECHANISM_EN[collab.mechanism]}
                      </p>
                    )}
                    {collab.goods.length > 0 && (
                      <p className="text-xs">
                        <span className="opacity-70">Merch mentioned in the announcement: </span>
                        {collab.goods.map((noun, i) => (
                          <span key={noun}>
                            {i > 0 && " · "}
                            <span lang={hasGoodsLabelEn(noun) ? undefined : "ja"}>
                              {goodsLabel(noun, "en")}
                            </span>
                          </span>
                        ))}
                      </p>
                    )}
                    {collab.sale.length > 0 && (
                      <div className="text-xs">
                        <span className="opacity-70">Listed on the official page: </span>
                        <ul className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                          {collab.sale.map((s) => (
                            <li key={`${s.noun}${s.price}`}>
                              <span lang={hasGoodsLabelEn(s.noun) ? undefined : "ja"}>
                                {goodsLabel(s.noun, "en")}
                              </span>
                              <span className="ml-1 font-medium">{s.price}</span>
                            </li>
                          ))}
                        </ul>
                        {/* 価格は公式ページから取った定価。買えることも在庫も約束しない。 */}
                        <p className="mt-0.5 opacity-70">
                          Prices are the official listed prices in Japan, excluding any shipping or
                          proxy fees.
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <span lang="ja" className="ml-1">{item.highlights.replace(/^[^：]+：/, "")}</span>
                )}
                {item.hasLottery && (
                  <p className="mt-0.5 text-xs text-purple-700/80 dark:text-purple-300/80">
                    Includes prizes decided by lottery or random draw — you cannot pick a specific prize.
                  </p>
                )}
              </div>
            )
          )}

          {/* 公式・一次情報・購入導線のみ（収集元のURLは非公開＝JAと同じ規則）。リンク先は日本語サイト。 */}
          <div className="mt-2 flex flex-col gap-2">
            {isOfficialUrl(item.source) && (
              <OutboundLink
                href={officialHref}
                kind="official"
                source={sourceCode(item.source)}
                itemId={item.id}
                className={primaryBtn}
              >
                View official page →
              </OutboundLink>
            )}
            {item.officialUrl && (
              <OutboundLink
                href={item.officialUrl}
                kind="official_secondary"
                source={sourceCode(item.source)}
                itemId={item.id}
                className={primaryBtn}
              >
                {officialUrlLabelEn(item.highlights, item.source)}
              </OutboundLink>
            )}
            {showRakuten && (
              <OutboundLink
                href={rakutenSearchUrl(hasSearchableTitle(item.source) ? item.title : displayTitle)}
                kind="rakuten"
                source={sourceCode(item.source)}
                itemId={item.id}
                className="inline-flex items-center justify-center rounded-lg border border-rose-600 px-4 py-2.5 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 dark:border-rose-400 dark:text-rose-400 dark:hover:bg-rose-950"
              >
                Search on Rakuten (Japan) →
              </OutboundLink>
            )}
          </div>
          {/* 受付が終わった行に「最新の在庫・価格・応募条件を確認して」と書くと、
              まだ買えるように読める。言えることに合わせて注記を差し替える。 */}
          <p className="text-xs text-neutral-600 dark:text-neutral-400">
            {pastInfo?.kind === "ended"
              ? "This listing is in the past. Linked pages are in Japanese; check there for any restock or reopening. All dates are JST."
              : "Linked pages are in Japanese. Check the latest stock, price and entry conditions there. All dates are JST."}
          </p>
          <p className="text-xs">
            <Link href="/en/how-to-buy" className="text-rose-600 hover:underline dark:text-rose-400">
              New to ordering from Japan? How to buy from Japan →
            </Link>
          </p>
        </div>
      </div>

      {/* 同じ商品の販売単位（ばら売り/BOX/カートン）。単位ラベルは収集元の表記のまま。 */}
      {saleUnits.length > 1 && (
        <section className="mt-10">
          <h2 className="mb-1 text-lg font-bold text-neutral-900 dark:text-neutral-50">
            📦 Sale units ({saleUnits.length})
          </h2>
          <p className="mb-3 text-xs text-neutral-600 dark:text-neutral-400">
            The same product is sold in different units, each with its own price.
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {saleUnits.map((u) => (
              <li
                key={u.id}
                className={`flex items-center justify-between gap-3 rounded-lg border p-3 ${
                  u.id === item.id
                    ? "border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/30"
                    : "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
                }`}
              >
                <div className="min-w-0">
                  <div className="truncate font-semibold text-neutral-900 dark:text-neutral-100">
                    <span lang="ja">{u.label}</span>
                    {u.id === item.id && (
                      <span className="ml-1 text-xs font-normal text-neutral-600 dark:text-neutral-400">
                        (this page)
                      </span>
                    )}
                  </div>
                  {u.price && (
                    <div lang="ja" className="mt-0.5 text-xs font-semibold text-rose-600 dark:text-rose-400">
                      {u.price}
                    </div>
                  )}
                </div>
                {u.id !== item.id && (
                  <Link
                    href={`/en/items/${u.id}`}
                    className="shrink-0 rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-rose-700"
                  >
                    View this unit →
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 受付中ストア一覧／開催店舗。締切が過ぎた枠を「受付中」に混ぜない（JAと同じ判定）。 */}
      {storeList && (
        <section className="mt-10">
          <h2 className="mb-1 text-lg font-bold text-neutral-900 dark:text-neutral-50">
            {storeCopy.heading} ({storeGroups.length}
            {item.source === "collabo_cafe"
              ? ` venue${storeGroups.length === 1 ? "" : "s"}`
              : ` store${storeGroups.length === 1 ? "" : "s"} · ${openStores.length} entry page${openStores.length === 1 ? "" : "s"}`})
          </h2>
          <p className="mb-3 text-xs text-neutral-600 dark:text-neutral-400">
            {storeCopy.note}
            {/* 落とした分は黙って消さず件数で書く（「情報が無い」と「隠した」を区別可能に）。 */}
            {closedStoreCount > 0 && ` (${closedStoreCount} past-deadline entries are not shown.)`}
          </p>
          {openStores.length === 0 && (
            <p className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
              No stores are currently accepting entries ({closedStoreCount} deadlines have passed).
            </p>
          )}
          <ul className="grid gap-2 sm:grid-cols-2">
            {storeGroups.flatMap((g) =>
              g.entries.map((s, i) => {
                const whenLabel = storeWhenLabelEn(s, todayJst());
                return (
                  <li
                    key={s.name + (s.url ?? "")}
                    className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-neutral-900 dark:text-neutral-100">
                        <span lang="ja">{s.name}</span>
                        {g.entries.length > 1 && item.source !== "collabo_cafe" && (
                          <span className="ml-1 text-xs font-normal text-neutral-600 dark:text-neutral-400">
                            entry page {i + 1}/{g.entries.length}
                          </span>
                        )}
                      </div>
                      {(s.form || whenLabel) && (
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
                          {s.form && (
                            <span lang="ja" className="rounded bg-purple-100 px-1.5 py-0.5 font-medium text-purple-800 dark:bg-purple-900/40 dark:text-purple-200">
                              {s.form}
                            </span>
                          )}
                          {whenLabel && (
                            <span lang="ja" className="font-semibold text-rose-600 dark:text-rose-400">{whenLabel}</span>
                          )}
                        </div>
                      )}
                      {s.note && (
                        <p className="mt-1 text-xs leading-snug text-neutral-600 dark:text-neutral-400">
                          Conditions: <span lang="ja">{s.note}</span>
                        </p>
                      )}
                    </div>
                    {s.url && (
                      <OutboundLink
                        href={s.url}
                        kind="official"
                        source={sourceCode(item.source)}
                        itemId={item.id}
                        className="shrink-0 rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-rose-700"
                      >
                        {storeCopy.button}
                      </OutboundLink>
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </section>
      )}

      {/* 各等賞ギャラリー。賞名・賞ラベルは原文のまま。 */}
      {prizeGallery && (
        <section className="mt-10">
          <h2 className="mb-1 text-lg font-bold text-neutral-900 dark:text-neutral-50">
            🎯 Prize lineup ({prizeGallery.length} tiers · kuji)
          </h2>
          <p className="mb-3 text-xs text-neutral-600 dark:text-neutral-400">
            Prizes are won by drawing a kuji (lottery ticket).{" "}
            {prizesGraded
              ? "The A-Prize and Last One Prize have the fewest pieces and cannot be chosen."
              : "Prizes with lower win rates (badge, top-left) have the fewest pieces and cannot be chosen."}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {prizeGallery.map((p, i) => {
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
                        src={proxiedImageUrl(item.id, p.image, i)!}
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
                      lang="ja"
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
                    <p lang="ja" className="line-clamp-3 flex-1 text-sm leading-snug text-neutral-800 dark:text-neutral-100">
                      {p.name}
                    </p>
                    {/* 「選べる」＝狙って手に入るか。英語でも同じ事実だけを出す。
                        サイズは収集元の日本語表記そのままなので lang="ja" を付ける。 */}
                    {(p.variants || p.size) && (
                      <div className="flex flex-wrap items-center gap-1 text-[11px] leading-tight">
                        {p.variants && (
                          <span
                            className={`rounded px-1.5 py-0.5 font-bold ${
                              p.choosable
                                ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100"
                                : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                            }`}
                          >
                            {p.variants} type{p.variants > 1 ? "s" : ""}
                            {p.choosable ? " · you pick" : ""}
                          </span>
                        )}
                        {p.size && (
                          <span lang="ja" className="text-neutral-600 dark:text-neutral-400">
                            {p.size}
                          </span>
                        )}
                      </div>
                    )}
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
            More from <span lang="ja">「{related.seriesLabel}」</span>
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {related.series.map((r) => (
              <ItemCard key={r.id} item={toCardItem(r)} locale="en" />
            ))}
          </div>
        </section>
      )}

      {related.genre.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-lg font-bold text-neutral-900 dark:text-neutral-50">
            Upcoming {genreLabel(item.genre, "en").toLowerCase()}
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {related.genre.map((r) => (
              <ItemCard key={r.id} item={toCardItem(r)} locale="en" />
            ))}
          </div>
          <p className="mt-4 text-sm">
            <a
              href={`/en?genre=${encodeURIComponent(item.genre)}`}
              className="text-rose-600 hover:underline dark:text-rose-400"
            >
              See all {genreLabel(item.genre, "en").toLowerCase()} →
            </a>
          </p>
        </section>
      )}
    </main>
  );
}
