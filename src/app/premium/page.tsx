import type { Metadata } from "next";
import Link from "next/link";
import { ItemCard } from "@/components/ItemCard";
import { getPremiumItems } from "@/lib/seo";

// 相場データは scrape:prices / X巡回で増える。ISRで30分ごとに再生成。
export const revalidate = 1800;

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "";

// 文言は実際に載っているものだけを約束する。ここは「相場が確認できた品」を相場額順に並べる
// ページで、全部がプレ値とは限らない（定価どおりの品も混ざる）。「定価より高く取引されている
// アイテムを掲載」と書くと、定価比 +0% の品が並んだ時点で嘘になる。→ [[UIラベルは裏取り済みのみ約束]]
const DESCRIPTION =
  "フィギュア・トレカ・一番くじ・スニーカーなどで、実際の取引価格（相場）が確認できたアイテムを相場額の高い順にまとめています。定価が分かるものは定価比（プレ値かどうか）も表示。発売済みで通常の一覧からは見えなくなった品も掲載。相場は駿河屋の中古価格・Xの実売（メルカリ等）を参照。";

export const metadata: Metadata = {
  title: "相場・プレ値ランキング｜発売済みレア品の中古・転売相場 | ハツコレ",
  description: DESCRIPTION,
  alternates: SITE ? { canonical: `${SITE}/premium` } : undefined,
  openGraph: { title: "相場・プレ値ランキング | ハツコレ", description: DESCRIPTION, type: "website" },
};

export default async function PremiumPage() {
  const items = await getPremiumItems();

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
      <nav className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
        <Link href="/" className="hover:underline">
          ハツコレ
        </Link>
        {" ／ 相場・プレ値"}
      </nav>

      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-3xl">
          相場・プレ値ランキング
        </h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          実際の取引価格（相場）が確認できたアイテムを、相場額の高い順に掲載。
          定価が分かるものは定価比も表示します。発売済みで通常の一覧からは見えなくなった品も含みます。
        </p>
        <p className="mt-2 text-xs text-neutral-400">
          相場 {items.length} 件（駿河屋の中古価格・Xの実売相場を参照）
        </p>
      </header>

      {items.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {items.map((it) => (
            <ItemCard key={it.id} item={it} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          まだ相場データがありません。相場は順次付与されます。
        </p>
      )}

      <p className="mt-8 text-xs text-neutral-400">
        ※ 相場は日々変動します。実際の売買価格・在庫は各リンク先でご確認ください。
        本ページは情報提供が目的で、投機や高額転売を推奨するものではありません。
      </p>
    </main>
  );
}
