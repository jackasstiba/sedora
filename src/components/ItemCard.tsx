import { sourceLabel } from "@/lib/items";
import { formatShort } from "@/lib/date";

type Item = {
  id: number;
  source: string;
  title: string;
  genre: string;
  subGenre: string | null;
  eventType: string;
  eventDate: Date | null;
  eventDateText: string | null;
  price: string | null;
  url: string;
  imageUrl: string | null;
};

const GREEN = "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300";
const BLUE = "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300";
const PURPLE = "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300";
const AMBER = "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";

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
  再販: BLUE,
  // 開催（コラボ等）＝アンバー
  開催: AMBER,
};

function eventColor(eventType: string): string {
  return EVENT_COLORS[eventType] ?? "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200";
}

function formatDate(date: Date | null): string | null {
  return date ? formatShort(date) : null;
}

export function ItemCard({ item }: { item: Item }) {
  const dateLabel = formatDate(item.eventDate) ?? item.eventDateText;

  return (
    <a
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
          <div className="flex h-full w-full items-center justify-center text-neutral-400">
            <span className="text-sm">画像なし</span>
          </div>
        )}
        <span
          className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-xs font-semibold ${eventColor(item.eventType)}`}
        >
          {item.eventType}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            {item.subGenre ?? item.genre}
          </span>
          {dateLabel && (
            <span className="font-semibold text-rose-600 dark:text-rose-400">{dateLabel}</span>
          )}
        </div>

        <h3 className="line-clamp-3 flex-1 text-sm font-medium leading-snug text-neutral-900 dark:text-neutral-100">
          {item.title}
        </h3>

        <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
          <span className="truncate">{sourceLabel(item.source)}</span>
          {item.price && <span className="font-medium text-neutral-700 dark:text-neutral-200">{item.price.split(" / ")[0]}</span>}
        </div>
      </div>
    </a>
  );
}
