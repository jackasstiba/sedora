"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { track } from "@vercel/analytics";

type Props = {
  genres: { genre: string; count: number }[];
  activeGenre: string;
  activeSort: string;
  activeQuery: string;
  activeStatus: string;
  activeWhen: string;
};

const STATUS_TABS: { value: string; label: string }[] = [
  { value: "", label: "すべて" },
  { value: "reserve", label: "予約" },
  { value: "lottery", label: "抽選" },
  { value: "release", label: "発売・登場" },
];

const WHEN_TABS: { value: string; label: string }[] = [
  { value: "", label: "全期間" },
  { value: "week", label: "今週" },
  { value: "month", label: "今月" },
];

export function FilterBar({
  genres,
  activeGenre,
  activeSort,
  activeQuery,
  activeStatus,
  activeWhen,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [queryInput, setQueryInput] = useState(activeQuery);

  function updateParam(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    router.push(`/?${params.toString()}`);
  }

  return (
    <div className="flex flex-col gap-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          updateParam({ q: queryInput.trim() || null });
        }}
        className="flex gap-2"
      >
        <input
          type="search"
          value={queryInput}
          onChange={(e) => setQueryInput(e.target.value)}
          placeholder="商品名で検索（例: 初音ミク、ポケカ）"
          className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-rose-500 dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          type="submit"
          className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700"
        >
          検索
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => updateParam({ genre: null })}
          className={chipClass(activeGenre === "")}
        >
          すべて
        </button>
        {genres.map(({ genre, count }) => (
          <button
            key={genre}
            onClick={() => {
              // どのジャンルが見られているかを解析できるようにイベント記録
              track("genre_select", { genre });
              updateParam({ genre });
            }}
            className={chipClass(activeGenre === genre)}
          >
            {genre}
            <span className="ml-1 opacity-60">{count}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <div className="flex items-center gap-1.5">
          <span className="text-neutral-500 dark:text-neutral-400">種別:</span>
          {STATUS_TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => updateParam({ status: t.value || null })}
              className={pillClass(activeStatus === t.value, t.value === "lottery")}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-neutral-500 dark:text-neutral-400">時期:</span>
          {WHEN_TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => updateParam({ when: t.value || null })}
              className={pillClass(activeWhen === t.value, false)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span className="text-neutral-500 dark:text-neutral-400">並び替え:</span>
        <button
          onClick={() => updateParam({ sort: null })}
          className={sortClass(activeSort !== "recent")}
        >
          発売・予約日順
        </button>
        <button
          onClick={() => updateParam({ sort: "recent" })}
          className={sortClass(activeSort === "recent")}
        >
          新着順
        </button>
      </div>
    </div>
  );
}

function chipClass(active: boolean): string {
  return `rounded-full border px-3 py-1 text-sm transition ${
    active
      ? "border-rose-600 bg-rose-600 text-white"
      : "border-neutral-300 bg-white text-neutral-700 hover:border-rose-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
  }`;
}

function pillClass(active: boolean, isLottery: boolean): string {
  if (active) {
    const color = isLottery ? "bg-purple-600" : "bg-neutral-800 dark:bg-neutral-200 dark:text-neutral-900";
    return `rounded-md px-2.5 py-1 font-semibold text-white ${color}`;
  }
  const idle = isLottery
    ? "text-purple-700 hover:bg-purple-50 dark:text-purple-300 dark:hover:bg-purple-900/30"
    : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800";
  return `rounded-md px-2.5 py-1 ${idle}`;
}

function sortClass(active: boolean): string {
  return `rounded-md px-2 py-1 transition ${
    active
      ? "bg-neutral-200 font-semibold text-neutral-900 dark:bg-neutral-700 dark:text-neutral-100"
      : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
  }`;
}
