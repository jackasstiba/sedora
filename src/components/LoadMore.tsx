"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

// トップページは force-dynamic で全件を一度に描画すると重い（790件・画像数百枚・HTML数MB）。
// そこで初期表示を絞り、このボタンで ?show=N を増やして追加分をサーバー描画で継ぎ足す。
// useSearchParams は使わず（この改変Nextでは Suspense 境界がフォールバック固着する地雷）、
// 現在の絞り込み状態は props で受け取って URL を再構築する。
type Props = {
  activeGenre: string;
  activeQuery: string;
  activeStatus: string;
  activeWhen: string;
  activeDatedOnly: boolean;
  nextShow: number;
  remaining: number;
};

export function LoadMore({
  activeGenre,
  activeQuery,
  activeStatus,
  activeWhen,
  activeDatedOnly,
  nextShow,
  remaining,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onClick() {
    const params = new URLSearchParams();
    if (activeGenre) params.set("genre", activeGenre);
    if (activeQuery) params.set("q", activeQuery);
    if (activeStatus) params.set("status", activeStatus);
    if (activeWhen) params.set("when", activeWhen);
    if (activeDatedOnly) params.set("dated", "1");
    params.set("show", String(nextShow));
    // scroll:false で「もっと見る」押下後もスクロール位置を保持（先頭に戻さない）
    startTransition(() => router.push(`/?${params.toString()}`, { scroll: false }));
  }

  return (
    <div className="mt-8 flex justify-center">
      <button
        onClick={onClick}
        disabled={isPending}
        aria-busy={isPending}
        className="rounded-lg border border-neutral-300 bg-white px-6 py-2.5 text-sm font-semibold text-neutral-700 transition hover:border-rose-400 hover:text-rose-600 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
      >
        {isPending ? "読み込み中…" : `もっと見る（残り${remaining}件）`}
      </button>
    </div>
  );
}
