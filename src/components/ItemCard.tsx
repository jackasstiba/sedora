import Link from "next/link";
import { countdown, displayEventType, eventDateLabel, isMonthPrecision, todayJst } from "@/lib/date";
import { computeMargin, formatPct, formatPriceDisplay } from "@/lib/margin";
import { cleanListTitle, displaySubGenre } from "@/lib/title";
import { NoImage } from "./NoImage";

// eventDate は Date（サーバー）／ISO文字列（クライアントへ渡した後）どちらも受ける。
export type Item = {
  id: number;
  source: string;
  title: string;
  genre: string;
  subGenre: string | null;
  eventType: string;
  eventDate: Date | string | null;
  eventDateText: string | null;
  price: string | null;
  url: string;
  imageUrl: string | null;
  marketPrice?: number | null;
  marketPriceText?: string | null;
  highlights?: string | null;
  hasLottery?: boolean | null;
};

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

export function ItemCard({ item }: { item: Item }) {
  // 日付は「分かっている精度」でしか書かない。発売日でないテキスト（投稿日）は出さず、
  // 月までしか分からないものは特定日にしない（「2026年9月」と出す）。
  const dateLabel = eventDateLabel(item.eventDate, item.eventDateText, "short");
  // 月精度のものに「🔥 本日/明日」を出すと、合成した月初へのカウントダウンになってしまう。
  const cd = isMonthPrecision(item.eventDateText) ? null : countdown(item.eventDate);
  const margin = computeMargin(item.price, item.marketPrice);
  // 一覧では商品名へ寄せて整形（Xミラーの実況コメント込みタイトル対策）。詳細ページは全文表示。
  const displayTitle = cleanListTitle(item.source, item.title);
  // 予定日が過ぎたものを「予定」と書かない（登場予定 → 登場済み）。
  const eventLabel = displayEventType(item.eventType, item.eventDate, item.eventDateText, todayJst());

  return (
    <Link
      href={`/items/${item.id}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900"
    >
      <div className="relative aspect-square w-full overflow-hidden bg-neutral-100 dark:bg-neutral-800">
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.imageUrl}
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
          {eventLabel}
        </span>
        {cd && (
          <span
            className={`absolute right-2 top-2 rounded-full px-2 py-0.5 text-xs font-bold shadow-sm ${COUNTDOWN_TONE[cd.tone]}`}
          >
            {cd.tone === "urgent" ? "🔥 " : ""}
            {cd.text}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            {displaySubGenre(item.subGenre) ?? item.genre}
          </span>
          {dateLabel && (
            <span className="font-semibold text-rose-600 dark:text-rose-400">{dateLabel}</span>
          )}
        </div>

        {/* 画像ありは商品名を本文に。画像なしは NoImage タイル側で商品名を主役に出すため重複を避ける。 */}
        {item.imageUrl ? (
          <h3 className="line-clamp-3 flex-1 text-sm font-medium leading-snug text-neutral-900 dark:text-neutral-100">
            {displayTitle}
          </h3>
        ) : (
          <div className="flex-1" aria-hidden />
        )}

        {/* コラボ記事本文から抽出した注目賞品（抽選/ランダムの高額品＝せどりの本命）。 */}
        {item.highlights && (
          <p
            className={`line-clamp-2 rounded px-1.5 py-1 text-xs leading-snug ${
              item.hasLottery
                ? "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200"
                : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
            }`}
          >
            {item.hasLottery ? "🎯 " : "🛍 "}
            {item.highlights}
          </p>
        )}

        {item.price && (
          <div className="flex items-center justify-end text-xs text-neutral-500 dark:text-neutral-400">
            <span className="font-medium text-neutral-700 dark:text-neutral-200">{formatPriceDisplay(item.price.split(" / ")[0])}</span>
          </div>
        )}

        {item.marketPriceText && (
          <div className="-mt-1 flex flex-wrap items-center gap-1 text-xs">
            <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
              相場 {item.marketPriceText}
            </span>
            {margin && (
              <span
                className={`rounded px-1.5 py-0.5 font-semibold ${
                  margin.isPremium
                    ? "bg-rose-600 text-white"
                    : "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200"
                }`}
                title={`定価 ¥${margin.teika.toLocaleString("ja-JP")} → 相場 ¥${margin.market.toLocaleString("ja-JP")}`}
              >
                定価比 {formatPct(margin.pct)}
              </span>
            )}
          </div>
        )}
      </div>
    </Link>
  );
}
