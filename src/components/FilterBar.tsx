"use client";

import { useEffect, useRef, useState } from "react";
import { track } from "@vercel/analytics";
import { logEvent } from "@/lib/logEvent";

// 制御コンポーネント化: 絞り込みはサーバー往復ではなく親(ItemBrowser)のローカル状態で
// 即時に行う。ここは値を表示し、変更を onChange で親に伝えるだけ。
export type FilterValues = {
  genre: string;
  query: string;
  status: string;
  when: string;
  datedOnly: boolean;
};

type Props = {
  genres: { genre: string; count: number }[];
  values: FilterValues;
  onChange: (patch: Partial<FilterValues>) => void;
  onClear: () => void;
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

export function FilterBar({ genres, values, onChange, onClear }: Props) {
  const { genre, status, when, datedOnly } = values;
  // 検索欄だけは入力中の未確定文字を持つためローカル state。全件がクライアント側にあるので
  // 入力するそばから即時フィルタする（サーバー往復ゼロ＝体感が速い）。
  const [queryInput, setQueryInput] = useState(values.query);

  // 「条件をクリア」等で外部から query が変わったら入力欄も追従（レンダー中に調整）。
  const [prevQuery, setPrevQuery] = useState(values.query);
  if (values.query !== prevQuery) {
    setPrevQuery(values.query);
    setQueryInput(values.query);
  }

  // 入力ごとに即時フィルタ（220msデバウンス＝1文字ごとの再絞り込み連打を軽く間引く）。
  const trackedRef = useRef(values.query);
  useEffect(() => {
    const q = queryInput.trim();
    if (q === values.query) return; // 既に反映済み（外部クリア追従・送信直後など）
    const h = setTimeout(() => onChange({ query: q }), 220);
    return () => clearTimeout(h);
    // onChange/values.query を依存に入れると毎レンダーで張り直すので queryInput のみを見る。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryInput]);

  // 需要シグナル（何を検索されたか）の記録は、入力が落ち着いてから1回だけ（900ms）。
  // 1文字ごとに送るとイベントが荒れるので、確定した検索語だけを重複なく送る。
  useEffect(() => {
    const q = queryInput.trim();
    if (q.length < 2 || q === trackedRef.current) return;
    const h = setTimeout(() => {
      trackedRef.current = q;
      track("search", { query: q });
      logEvent("search", q);
    }, 900);
    return () => clearTimeout(h);
  }, [queryInput]);

  const anyActive =
    Boolean(genre) || Boolean(values.query) || Boolean(status) || Boolean(when) || datedOnly;

  return (
    <div className="flex flex-col gap-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          // Enter/ボタンでも確定（即時フィルタ済みだが、モバイルでキーボードを閉じる導線）。
          onChange({ query: queryInput.trim() });
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
        <button onClick={() => onChange({ genre: "" })} className={chipClass(genre === "")}>
          すべて
        </button>
        {genres.map(({ genre: g, count }) => (
          <button
            key={g}
            onClick={() => {
              // どのジャンルが見られているかを解析できるようにイベント記録
              track("genre_select", { genre: g });
              logEvent("genre_select", g);
              onChange({ genre: g });
            }}
            className={chipClass(genre === g)}
          >
            {g}
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
              onClick={() => onChange({ status: t.value })}
              className={pillClass(status === t.value, t.value === "lottery")}
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
              onClick={() => onChange({ when: t.value })}
              className={pillClass(when === t.value, false)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => onChange({ datedOnly: !datedOnly })}
          className={pillClass(datedOnly, false)}
        >
          日付未定を隠す
        </button>
        {anyActive && (
          <button
            onClick={onClear}
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
