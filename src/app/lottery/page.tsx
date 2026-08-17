import type { Metadata } from "next";
import Link from "next/link";
import { ItemCard } from "@/components/ItemCard";
import { getLotteryItems } from "@/lib/seo";

// 抽選は締切が動くのでISRで30分ごとに再生成。
export const revalidate = 1800;

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "";

const DESCRIPTION =
  "スニーカー・一番くじ・トレカ・コラボ限定品・Nintendo Switch 2 / GeForce RTX など家電・ゲーム機の、いま応募できる抽選・予約抽選をまとめて掲載。締切の近い順で、当選＝定価入手＝せどりの本命を見逃さないための一覧です。";

export const metadata: Metadata = {
  title: "抽選・予約抽選まとめ｜いま応募できるレア・限定品の抽選 | ハツコレ",
  description: DESCRIPTION,
  alternates: SITE ? { canonical: `${SITE}/lottery` } : undefined,
  openGraph: { title: "抽選・予約抽選まとめ | ハツコレ", description: DESCRIPTION, type: "website" },
};

export default async function LotteryPage() {
  const items = await getLotteryItems();

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
      <nav className="mb-2 text-xs text-neutral-600 dark:text-neutral-400">
        <Link href="/" className="hover:underline">
          ハツコレ
        </Link>
        {" ／ 抽選"}
      </nav>

      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-3xl">
          抽選・予約抽選まとめ
        </h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          いま応募できる抽選・予約抽選を、締切の近い順に集約。スニーカー・一番くじ・トレカ・コラボ限定品に加え、
          Nintendo Switch 2 / GeForce RTX など家電・ゲーム機の抽選も掲載します。
        </p>
        <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">受付中・予定 {items.length} 件</p>
      </header>

      {items.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {items.map((it) => (
            <ItemCard key={it.id} item={it} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          いま受付中の抽選はありません。新しい抽選は順次掲載されます。
        </p>
      )}

      <p className="mt-8 text-xs text-neutral-600 dark:text-neutral-400">
        ※ 応募条件（購入履歴・会員登録など）・締切・在庫は各リンク先の公式ページで最新をご確認ください。
        本ページは情報提供が目的で、投機や高額転売を推奨するものではありません。
      </p>
    </main>
  );
}
