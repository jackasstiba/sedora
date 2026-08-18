import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ItemCard } from "@/components/ItemCard";
import { MonthCalendar } from "@/components/MonthCalendar";
import { getItemsByMonth, getMonthsWithItems, isValidMonth, monthLabel } from "@/lib/seo";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export const revalidate = 1800; // 30分ISRキャッシュ（表示高速化・Turso負荷減）

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "";

export async function generateStaticParams() {
  const months = await getMonthsWithItems();
  return months.map((month) => ({ month }));
}

type Props = { params: Promise<{ month: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { month } = await params;
  if (!isValidMonth(month)) return { title: "見つかりませんでした | ハツコレ" };
  const label = monthLabel(month);
  const title = `${label}発売・予約のレア・限定アイテム一覧 | ハツコレ`;
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

  // 日ごとに件数を集計＋グループ化（カレンダーと日別セクションで使う）
  //
  // ⚠️ 日にちだけ（getUTCDate）で束ねてはいけない。この月に載る行の中には、**応募期間が
  // この月にかかっているが、いま表示している締切は別の月**というものがある（月をまたぐ抽選。
  // 所属の決め方は getItemsByMonth を参照）。日にちだけで束ねると、10/24 のカードが
  // 「9月24日」の見出しの下に並び、カレンダーの24日の件数にも足される＝**見出しが嘘になる**
  // （2026-08-18 に実際にそうなっていた。Xbox の 10/24 が 9月24日 の欄にいた）。
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1;
  const counts: Record<number, number> = {};
  const byDay = new Map<number, typeof items>();
  const crossMonth: typeof items = [];
  for (const it of items) {
    if (!it.eventDate) continue;
    const d = new Date(it.eventDate);
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== monthIndex) {
      crossMonth.push(it);
      continue;
    }
    const day = d.getUTCDate();
    counts[day] = (counts[day] ?? 0) + 1;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(it);
  }
  const days = [...byDay.keys()].sort((a, b) => a - b);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "ハツコレ", item: SITE || undefined },
      { "@type": "ListItem", position: 2, name: label },
    ],
  };

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <nav className="mb-4 text-xs text-neutral-600 dark:text-neutral-400">
        <Link href="/" className="hover:underline">
          ハツコレ
        </Link>
        {" ／ "}
        {label}
      </nav>

      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
          {label}発売・予約のレア・限定アイテム
        </h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          日付順・{items.length}件
        </p>
      </header>

      <MonthCalendar month={month} counts={counts} />

      <div className="flex flex-col gap-8">
        {days.map((day) => {
          const dayItems = byDay.get(day)!;
          const dow = new Date(Date.UTC(year, monthIndex, day)).getUTCDay();
          return (
            <section key={day} id={`day-${day}`} className="scroll-mt-4">
              <h2 className="mb-3 text-lg font-bold text-neutral-900 dark:text-neutral-50">
                {Number(month.slice(5, 7))}月{day}日
                <span className="ml-1 text-sm font-normal text-neutral-600 dark:text-neutral-400">
                  ({WEEKDAYS[dow]}) {dayItems.length}件
                </span>
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {dayItems.map((item) => (
                  <ItemCard key={item.id} item={item} />
                ))}
              </div>
            </section>
          );
        })}

        {crossMonth.length > 0 && (
          // 月をまたぐ抽選。**この月にも応募できる**が、いま最短の締切は別の月にある。
          // 見出しでその事実だけを書く（カードの日付は実際の締切のまま＝裏取り済みのみ約束）。
          <section id="cross-month" className="scroll-mt-4">
            <h2 className="mb-3 text-lg font-bold text-neutral-900 dark:text-neutral-50">
              {label}も応募できる
              <span className="ml-1 text-sm font-normal text-neutral-600 dark:text-neutral-400">
                (最短の締切はこの月の外) {crossMonth.length}件
              </span>
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {crossMonth.map((item) => (
                <ItemCard key={item.id} item={item} />
              ))}
            </div>
          </section>
        )}
      </div>

      <nav className="mt-10 border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <p className="mb-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
          月別で見る
        </p>
        <div className="flex flex-wrap gap-2">
          {months
            .filter((m) => m !== month)
            .map((m) => (
              <Link
                key={m}
                href={`/release/${m}`}
                className="rounded-full border border-neutral-300 bg-white px-3 py-1 text-sm text-neutral-700 hover:border-rose-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
              >
                {monthLabel(m)}
              </Link>
            ))}
        </div>
      </nav>
    </main>
  );
}
