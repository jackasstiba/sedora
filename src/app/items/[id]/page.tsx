import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ItemCard } from "@/components/ItemCard";
import { NoImage } from "@/components/NoImage";
import { OutboundLink } from "@/components/OutboundLink";
import { formatPriceDisplay, isPerDrawFee, parseYen } from "@/lib/margin";
import { hasSearchableTitle, isOfficialUrl, officialUrlLabel, rakutenSearchUrl } from "@/lib/outbound";
import { getItemById, getRelatedItems } from "@/lib/seo";
import { eventDateHeading } from "@/lib/itemFilter";
import { countdown, displayEventType, eventDateLabel, eventPeriodText, isEventPast, isMonthPrecision, todayJst } from "@/lib/date";
import { cleanListTitle, displaySubGenre } from "@/lib/title";
import { isHotPrize, parseKujiLineup, parsePrizesJson } from "@/lib/prizes";
import {
  groupStoresByLabel,
  parseStoresJson,
  splitStoresByDeadline,
  storeSectionCopy,
  storeWhenLabel,
} from "@/lib/stores";

export const revalidate = 1800; // 30分ISRキャッシュ（表示高速化・Turso負荷減）

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const item = await getItemById(Number(id));
  if (!item) return { title: "見つかりませんでした | ハツコレ" };

  const dateStr = eventDateLabel(item.eventDate, item.eventDateText, "long") ?? "";
  // 一覧カードと同じ整形を使う。以前は stripSourceLabel だけだったため、Xミラー由来の商品は
  // 一覧では商品名なのに、開いた先のタイトル・<title> がツイート全文（実況コメント込み）になり、
  // 同じ商品の名前がページ間で食い違っていた。
  const cleanTitle = cleanListTitle(item.source, item.title);
  const title = `${cleanTitle} | ハツコレ`;
  // 事実だけを簡潔に（宣伝文句は入れない）
  const past = isEventPast(item.eventDate, item.eventDateText, todayJst());
  // 検索結果に出る説明文。**相場・転売実績は入れない**（[[System/rules]] ハツコレの立ち位置。
  // 相場を出すと転売サイト感が高まる）。載せるのは「逃すと買えない」側＝抽選の有無・
  // 賞品ラインナップ・取扱店。以前は日付/価格/ジャンルだけで、28.5%が持つ highlights も
  // 3.0%が持つ salesChannel も捨てていた＝どの商品も同じ書式の説明文になっていた。
  const trim = (v: string, max: number) => (v.length > max ? `${v.slice(0, max)}…` : v);
  const description = [
    dateStr ? `${eventDateHeading(item.eventType, item.eventDateText, past)}: ${dateStr}` : null,
    item.price ? `価格: ${item.price}` : null,
    item.hasLottery ? "抽選あり" : null,
    // highlights は「各賞ラインナップ：A賞…」のように接頭辞つきで入っているので、
    // 画面側（下の注目賞品欄）と同じ規則で接頭辞を落としてから載せる。
    item.highlights ? trim(item.highlights.replace(/^[^：]+：/, "").trim(), 60) : null,
    item.salesChannel ? `取扱: ${trim(item.salesChannel, 30)}` : null,
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
  // 一覧カードと同じ規則で、分かっている精度でしか日付を書かない。
  const dateLabel = eventDateLabel(item.eventDate, item.eventDateText, "long");
  // 月精度のものは合成した月初へのカウントダウンになるので出さない。
  const cd = isMonthPrecision(item.eventDateText) ? null : countdown(item.eventDate);
  // 受付期間・締切・時刻（収集元の文言のまま。暦日だけの言い換えなら null）。
  const periodText = eventPeriodText(item.eventDate, item.eventDateText);
  // 表示・構造化データは一覧カードと同じ整形後タイトルに揃える（情報元の定型ラベル除去を含む）。
  // ※ 楽天検索へのリンクだけは生タイトルを使う経路が別にある（検索語は情報量が多い方が当たる）。
  const displayTitle = cleanListTitle(item.source, item.title);
  // 一番くじの各等賞。構造化JSON（画像＋賞ごと相場）があればギャラリー表示、
  // 無ければ highlights の畳み込み文字列からリスト展開（旧データ後方互換）。
  const prizeGallery = parsePrizesJson(item.prizes);
  const lineup = prizeGallery ? null : parseKujiLineup(item.highlights);
  // 賞ギャラリーの見せ方を賞データから決める（ソース非依存）。
  // 一番くじ＝等級賞(A賞/ラストワン賞)＝labelが「賞」で終わる。raffle-kuji＝等級なしで
  // labelは当選確率(例「0.5%」)＝先頭ほど低確率＝高額の本命。二次相場(resale)は付く賞のみ。
  const prizesGraded = prizeGallery?.some((p) => /賞$/.test(p.label)) ?? false;
  // 家電・ゲーム機など「複数の小売が同時に抽選/予約応募中」の商品の受付中ストア一覧（公式直リンク）。
  const storeList = parseStoresJson(item.stores);
  // 「受付中」と書く以上、締切が過ぎた枠を混ぜない（2026-08-18 実測: 126店のうち30店が
  // 昨日締切で、しかも締切の昇順＝**先頭30店が全部死んでいた**）。判定は純関数に置く。
  const storeSplit = storeList ? splitStoresByDeadline(storeList, todayJst()) : null;
  const openStores = storeSplit?.open ?? [];
  const closedStoreCount = storeSplit?.closed.length ?? 0;
  // 同一表示ラベル（店名＋形式＋受付時刻）でまとめる。同じ店が別ページで複数口開くため。
  const storeGroups = groupStoresByLabel(openStores);
  // 節の見出し・説明・ボタン文言は中身に合わせる（コラボに「応募ページ」と書かない）。
  const storeCopy = storeSectionCopy(item.source);

  // Product構造化データの必須要件はoffers/review/aggregateRatingのいずれかをGoogleが要求する。
  // レビュー・評価は実データが無いので付けない（推測値は約束しない方針）。定価(price)は裏取り済みの
  // 事実なので、読めた場合のみOfferを付ける。availabilityは抽選/予約/発売予定で確定できないため省略。
  // くじの「1回850円」は参加費であって商品の価格ではないので Offer には出さない
  // （検索結果に「¥850」と出ると、当たる賞品がその値段で買えるように読める）。
  const teika = item.price && isPerDrawFee(item.price) ? null : parseYen(item.price);
  const productNode = teika
    ? {
        "@type": "Product",
        name: displayTitle,
        image: item.imageUrl ?? undefined,
        category: item.genre,
        description: `${displayTitle}の${item.eventType}情報（${item.genre}）`,
        ...(SITE ? { url: `${SITE}/items/${item.id}` } : {}),
        offers: {
          "@type": "Offer",
          price: teika,
          priceCurrency: "JPY",
          ...(SITE ? { url: `${SITE}/items/${item.id}` } : {}),
        },
      }
    : null;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      // 定価が読めない（イベント告知のみ等）商品はProductノードを出さない。
      // offers無しのProductは重大エラーになりリッチリザルトにもならないため、出さない方が健全。
      ...(productNode ? [productNode] : []),
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

      <nav className="mb-4 text-xs text-neutral-600 dark:text-neutral-400">
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
              {displayEventType(item.eventType, item.eventDate, item.eventDateText, todayJst())}
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
                <dt className="text-neutral-600 dark:text-neutral-400">{eventDateHeading(item.eventType, item.eventDateText, isEventPast(item.eventDate, item.eventDateText, todayJst()))}</dt>
                <dd className="font-semibold text-rose-600 dark:text-rose-400">
                  {dateLabel}
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
                      {cd.text}
                    </span>
                  )}
                </dd>
              </>
            )}
            {/* 受付期間・締切・時刻。「今から間に合うか」は仕入れ判断の生命線なのに、
                eventDateText に入っていても暦日ラベルに負けて出ていなかった（観点B 2026-08-15）。
                収集元の文言をそのまま出す＝精度を足さない。 */}
            {periodText && (
              <>
                <dt className="text-neutral-600 dark:text-neutral-400">受付・時刻</dt>
                <dd className="text-neutral-800 dark:text-neutral-100">{periodText}</dd>
              </>
            )}
            {item.price && (
              <>
                <dt className="text-neutral-600 dark:text-neutral-400">価格</dt>
                <dd className="text-neutral-800 dark:text-neutral-100">{formatPriceDisplay(item.price)}</dd>
              </>
            )}
            {/* 取扱店。一番くじは「賞品が何か」より先に「自分の行ける店に入るか」で動くので、
                1回いくら（価格）とセットで出す。収集元の平文をそのまま出す＝推測を足さない。 */}
            {item.salesChannel && (
              <>
                <dt className="text-neutral-600 dark:text-neutral-400">取扱店</dt>
                <dd className="text-neutral-800 dark:text-neutral-100">{item.salesChannel}</dd>
              </>
            )}
            {/* ※「相場 ¥…（駿河屋で見る）」と「定価比 +…%」の2行は 2026-08-10 に撤去。
                相場の出どころが実態と食い違っていたため保留（lib/seo.ts の getPremiumItems
                のコメント参照）。marketPrice* は DB に残るが表示してはいけない。 */}
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
            {/* 記事から辿った公式/一次リンク。実際に商品名・価格帯まで取得できた時だけ
                「販売内容を見る」と約束し、そうでなければ「公式ページを見る」に留める
                （販売内容の無いアニメ公式トップ等へ「販売内容を見る」と送客しないため）。 */}
            {item.officialUrl && (
              <OutboundLink
                href={item.officialUrl}
                kind="official_secondary"
                source={item.source}
                itemId={item.id}
                className="inline-flex items-center justify-center rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700"
              >
                {officialUrlLabel(item.highlights, item.source)}
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
                className="inline-flex items-center justify-center rounded-lg border border-rose-600 px-4 py-2.5 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 dark:border-rose-400 dark:text-rose-400 dark:hover:bg-rose-950"
              >
                楽天で探す →
              </OutboundLink>
            )}
          </div>
          <p className="text-xs text-neutral-600 dark:text-neutral-400">
            ※ 予約・購入は各リンク先で最新の在庫・価格・抽選条件をご確認ください。
          </p>
        </div>
      </div>

      {/* 「どこへ行けば/どこで応募すれば買えるか」。家電・ゲーム機は各小売の応募ページ、
          コラボ/ポップアップ/カフェは開催店舗（会場限定なのでここが買える唯一の場所）。 */}
      {storeList && (
        <section className="mt-10">
          <h2 className="mb-1 text-lg font-bold text-neutral-900 dark:text-neutral-50">
            {storeCopy.heading}（{storeGroups.length}
            {item.source === "collabo_cafe" ? "店舗" : `店・応募ページ ${openStores.length}件`}）
          </h2>
          <p className="mb-3 text-xs text-neutral-600 dark:text-neutral-400">
            {storeCopy.note}
            {/* 落とした分は黙って消さず、事実として件数を書く（「情報が無い」と「情報を
                隠した」を画面で区別できるようにする）。 */}
            {closedStoreCount > 0 && `（締切が過ぎた ${closedStoreCount}件は表示していません）`}
          </p>
          {openStores.length === 0 && (
            <p className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
              受付中のストアはありません（{closedStoreCount}件はすべて締切済み）。
            </p>
          )}
          <ul className="grid gap-2 sm:grid-cols-2">
            {storeGroups.flatMap((g) =>
              g.entries.map((s, i) => {
              // 受付時刻は保存文字列そのままではなく today から作る（保存物は絶対表記のまま）。
              const whenLabel = storeWhenLabel(s, todayJst());
              return (
              <li
                key={s.name + (s.url ?? "")}
                className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
              >
                <div className="min-w-0">
                  <div className="truncate font-semibold text-neutral-900 dark:text-neutral-100">
                    {s.name}
                    {/* 同じ店が別の応募ページを複数開くことがある。同じ行が2つ並ぶと区別が
                        つかないので、何口目かを事実として添える（推測は足さない）。 */}
                    {g.entries.length > 1 && item.source !== "collabo_cafe" && (
                      <span className="ml-1 text-xs font-normal text-neutral-600 dark:text-neutral-400">
                        応募ページ {i + 1}/{g.entries.length}
                      </span>
                    )}
                  </div>
                  {(s.form || whenLabel) && (
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
                      {s.form && (
                        <span className="rounded bg-purple-100 px-1.5 py-0.5 font-medium text-purple-800 dark:bg-purple-900/40 dark:text-purple-200">
                          {s.form}
                        </span>
                      )}
                      {whenLabel && <span className="font-semibold text-rose-600 dark:text-rose-400">{whenLabel}</span>}
                    </div>
                  )}
                  {s.note && (
                    <p className="mt-1 text-xs leading-snug text-neutral-600 dark:text-neutral-400">
                      条件: {s.note}
                    </p>
                  )}
                </div>
                {/* URLを持たない行がある（複数店舗開催では、記事の地図リンクがどの店の
                    ものか特定できないので紐づけない）。無い時はボタンを出さない。 */}
                {s.url && (
                  <OutboundLink
                    href={s.url}
                    kind="official"
                    source={item.source}
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

      {/* 各等賞ギャラリー（賞画像＋賞ごとの二次相場）。一番くじの“何が当たるか”を最も濃く見せる面。 */}
      {prizeGallery && (
        <section className="mt-10">
          <h2 className="mb-1 text-lg font-bold text-neutral-900 dark:text-neutral-50">
            🎯 {prizesGraded ? "各賞ラインナップ" : "賞品ラインナップ"}（全{prizeGallery.length}種・くじ）
          </h2>
          <p className="mb-3 text-xs text-neutral-600 dark:text-neutral-400">
            くじ（抽選）で当たる賞品です。
            {prizesGraded
              ? "A賞・ラストワン賞が本命（本数が最も少ない）。"
              : "当選確率が低い賞（左上のバッジ）ほど本数が少なく高額の本命。"}
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
                  {/* ※ 賞ごとの「相場 ¥…」バッジも同じ理由で撤去（2026-08-10）。 */}
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
