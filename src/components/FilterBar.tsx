"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { track } from "@vercel/analytics";

type Props = {
  genres: { genre: string; count: number }[];
  activeGenre: string;
  activeQuery: string;
  activeStatus: string;
  activeWhen: string;
  activeDatedOnly: boolean;
};

const STATUS_TABS: { value: string; label: string }[] = [
  { value: "", label: "すべて" },
  { value: "now", label: "速報(いま買える)" },
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
  activeQuery,
  activeStatus,
  activeWhen,
  activeDatedOnly,
}: Props) {
  const router = useRouter();
  const [queryInput, setQueryInput] = useState(activeQuery);
  // 絞り込みは force-dynamic ページの再取得（Turso問い合わせ）を伴うため待ちが出る。
  // isPending でその間だけ一覧を薄く表示し、「押したのに無反応」に見えるのを防ぐ。
  const [isPending, startTransition] = useTransition();

  // 「絞り込みをリセット」等で activeQuery が外部から変わったとき、検索欄の表示も
  // 追従させる（クライアント遷移では再マウントされず入力文字が残ってしまうため）。
  // effect ではなくレンダー中に前回値と比較して調整する React 公式パターン。
  const [prevQuery, setPrevQuery] = useState(activeQuery);
  if (activeQuery !== prevQuery) {
    setPrevQuery(activeQuery);
    setQueryInput(activeQuery);
  }

  const anyActive =
    Boolean(activeGenre) ||
    Boolean(activeQuery) ||
    Boolean(activeStatus) ||
    Boolean(activeWhen) ||
    activeDatedOnly;

  // 現在の絞り込み状態は全て props で受け取っているので、そこから URL パラメータを
  // 再構築する。以前は useSearchParams() を使っていたが、それがこの Client Component を
  // Suspense 境界のクライアント専用描画に落とし込み、本番で境界がフォールバック
  // （空白）のまま固まって「フィルタUIが丸ごと消える」不具合の原因になっていた。
  function updateParam(updates: Record<string, string | null>) {
    const params = new URLSearchParams();
    if (activeGenre) params.set("genre", activeGenre);
    if (activeQuery) params.set("q", activeQuery);
    if (activeStatus) params.set("status", activeStatus);
    if (activeWhen) params.set("when", activeWhen);
    if (activeDatedOnly) params.set("dated", "1");
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const qs = params.toString();
    startTransition(() => router.push(qs ? `/?${qs}` : "/"));
  }

  return (
    <div
      className={`flex flex-col gap-3 transition-opacity ${isPending ? "pointer-events-none opacity-50" : ""}`}
      aria-busy={isPending}
    >
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
        <button
          onClick={() => updateParam({ dated: activeDatedOnly ? null : "1" })}
          className={pillClass(activeDatedOnly, false)}
        >
          日付未定を隠す
        </button>
        {anyActive && (
          <button
            onClick={() => {
              setQueryInput("");
              startTransition(() => router.push("/"));
            }}
            className="rounded-md px-3 py-1.5 text-neutral-500 underline-offset-2 hover:text-rose-600 hover:underline dark:text-neutral-400 dark:hover:text-rose-400"
          >
            条件をクリア
          </button>
        )}
      </div>
    </div>
  );
}

function chipClass(active: boolean): string {
  return `rounded-full border px-3 py-1.5 text-sm transition ${
    active
      ? "border-rose-600 bg-rose-600 text-white"
      : "border-neutral-300 bg-white text-neutral-700 hover:border-rose-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
  }`;
}

function pillClass(active: boolean, isLottery: boolean): string {
  if (active) {
    const color = isLottery ? "bg-purple-600" : "bg-neutral-800 dark:bg-neutral-200 dark:text-neutral-900";
    return `rounded-md px-3 py-1.5 font-semibold text-white ${color}`;
  }
  const idle = isLottery
    ? "text-purple-700 hover:bg-purple-50 dark:text-purple-300 dark:hover:bg-purple-900/30"
    : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800";
  return `rounded-md px-3 py-1.5 ${idle}`;
}

