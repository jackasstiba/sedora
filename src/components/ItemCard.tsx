import Link from "next/link";
import { countdown, displayEventType, eventDateLabel, eventDateLabelEn, isMonthPrecision, todayJst } from "@/lib/date";
import { formatPriceDisplay } from "@/lib/margin";
import { displaySubGenre } from "@/lib/title";
import { countdownLabelEn, eventTypeLabel, genreLabel, type Locale } from "@/lib/i18n";
import { ONLINE_TAG_EN } from "@/lib/channel";
import { summarizeHighlightsEn } from "@/lib/collabHighlights";
import { NoImage } from "./NoImage";
import type { CardItem } from "@/lib/cardItem";

// カードが受け取れる形は1つだけ（src/lib/cardItem.ts）。**収集元が割れる url / imageUrl は
// 型として持てない**＝クライアントへ渡しようがない、という形で非公開方針を固定する。
export type Item = CardItem;

const GREEN = "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300";
const BLUE = "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300";
const PURPLE = "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300";
const AMBER = "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";

// 近日バッジの配色（緊急度）。urgent=本日/明日は目立つ柿色、soon/weekは徐々に落ち着かせる。
const COUNTDOWN_TONE: Record<"urgent" | "soon" | "week", string> = {
  urgent: "bg-rose-600 text-white",
  soon: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200",
  week: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
};

const EVENT_COLORS: Record<string, string> = {
  // 予約系＝緑
  予約: GREEN,
  予約開始: GREEN,
  予約受付中: GREEN,
  受付開始: GREEN,
  販売開始: GREEN,
  // 抽選＝紫（せどり重要・目立たせる）
  抽選: PURPLE,
  // 発売・登場系＝青
  発売: BLUE,
  登場予定: BLUE,
  // 予定日が過ぎたもの＝もう買える状態。急かす色にはしない。
  登場済み: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200",
  再販: BLUE,
  // 開催（コラボ等）＝アンバー
  開催: AMBER,
};

function eventColor(eventType: string): string {
  return EVENT_COLORS[eventType] ?? "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200";
}

export function ItemCard({ item, locale = "ja" }: { item: Item; locale?: Locale }) {
  const en = locale === "en";
  // 日付は「分かっている精度」でしか書かない。発売日でないテキスト（投稿日）は出さず、
  // 月までしか分からないものは特定日にしない（「2026年9月」と出す）。英語版も同じ規則
  // （eventDateLabelEn）。日付が無い行の eventDateText は日本語原文のまま＝訳して精度を足さない。
  const dateLabel = en
    ? eventDateLabelEn(item.eventDate, item.eventDateText)
    : eventDateLabel(item.eventDate, item.eventDateText, "short");
  // 月精度のものに「🔥 本日/明日」を出すと、合成した月初へのカウントダウンになってしまう。
  const cd = isMonthPrecision(item.eventDateText) ? null : countdown(item.eventDate);
  // 一覧では商品名へ寄せて整形（Xミラーの実況コメント込みタイトル対策）。詳細ページは全文表示。
  // タイトルは toCardItem が整形済み（整形に必要な収集元名はブラウザに送らないため）。
  const displayTitle = item.title;
  // 予定日が過ぎたものを「予定」と書かない（登場予定 → 登場済み）。色はJPの語彙で決め、
  // 表示だけを locale で替える（対応表に無い語は日本語のまま出す＝勝手な断定を足さない）。
  const eventLabel = displayEventType(item.eventType, item.eventDate, item.eventDateText, todayJst());
  // カード用の1行英語要約（コラボの決まった書式が読み解けたときだけ。null＝原文のまま出す）。
  const highlightsEn = en ? summarizeHighlightsEn(item.highlights) : null;

  return (
    <Link
      // ENのカードはEN詳細（/en/items/*）へ。日本語詳細に落とすと海外読者が迷子になる
      // （Phase 2b-2）。audit:page のカードセレクタは両方のプレフィクスを数える。
      href={en ? `/en/items/${item.id}` : `/items/${item.id}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900"
    >
      <div className="relative aspect-square w-full overflow-hidden bg-neutral-100 dark:bg-neutral-800">
        {item.image ? (
          // src は自ドメインのパス（/i/<商品ID>）。元の画像URLはサーバの中だけにある。
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.image}
            alt={item.title}
            loading="lazy"
            className="h-full w-full object-cover transition group-hover:scale-105"
          />
        ) : (
          <NoImage genre={item.genre} title={displayTitle} />
        )}
        <span
          className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-xs font-semibold ${eventColor(eventLabel)}`}
        >
          {eventTypeLabel(eventLabel, locale)}
        </span>
        {cd && (
          <span
            className={`absolute right-2 top-2 rounded-full px-2 py-0.5 text-xs font-bold shadow-sm ${COUNTDOWN_TONE[cd.tone]}`}
          >
            {cd.tone === "urgent" ? "🔥 " : ""}
            {en ? countdownLabelEn(cd.days) : cd.text}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            {/* 英語版はジャンルの英語ラベル（subGenre は自由記述の日本語なので出さない）。 */}
            {en ? genreLabel(item.genre, "en") : (displaySubGenre(item.subGenre) ?? item.genre)}
          </span>
          {/* 入手経路タグ（英語版のみ・裏取り済みの行だけ）。意味の定義はトップの脚注に1回だけ書く。 */}
          {en && item.online && (
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
              {ONLINE_TAG_EN}
            </span>
          )}
          {dateLabel && (
            <span className="font-semibold text-rose-600 dark:text-rose-400">{dateLabel}</span>
          )}
        </div>

        {/* 画像ありは商品名を本文に。画像なしは NoImage タイル側で商品名を主役に出すため重複を避ける。 */}
        {item.image ? (
          // 商品名は日本語の固有名なので英語版でも原文のまま（lang でスクリーンリーダーに言語を伝える）。
          <h3
            lang={en ? "ja" : undefined}
            className="line-clamp-3 flex-1 text-sm font-medium leading-snug text-neutral-900 dark:text-neutral-100"
          >
            {displayTitle}
          </h3>
        ) : (
          <div className="flex-1" aria-hidden />
        )}

        {/* コラボ記事本文から抽出した注目賞品（抽選/ランダムの高額品＝せどりの本命）。
            英語版では**書式が読み解けたときだけ**英語に組み直す（種別名のみ訳す）。
            読み解けない書式は原文のまま lang="ja" で出す＝勝手な言い換えをしない。 */}
        {item.highlights && (
          <p
            lang={en && !highlightsEn ? "ja" : undefined}
            className={`line-clamp-2 rounded px-1.5 py-1 text-xs leading-snug ${
              item.hasLottery
                ? "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200"
                : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
            }`}
          >
            {item.hasLottery ? "🎯 " : "🛍 "}
            {highlightsEn ?? item.highlights}
          </p>
        )}

        {item.price && (
          <div className="flex items-center justify-end text-xs text-neutral-600 dark:text-neutral-400">
            <span className="font-medium text-neutral-700 dark:text-neutral-200">{formatPriceDisplay(item.price.split(" / ")[0])}</span>
          </div>
        )}

        {/* ※「相場 ¥…／定価比 +…%」バッジは 2026-08-10 に撤去（相場の出どころが実態と
            食い違っていたため保留）。理由は lib/seo.ts の getPremiumItems のコメント。
            marketPrice* は型・DBには残っているが、**表示してはいけない**。 */}
      </div>
    </Link>
  );
}
