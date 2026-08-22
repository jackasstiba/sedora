"use client";

import { useEffect, useRef, useState } from "react";
import { track } from "@vercel/analytics";
import { logEvent } from "@/lib/logEvent";
import { genreLabel, UI, type Locale } from "@/lib/i18n";

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
  locale?: Locale;
  /**
   * カタログ面（/en/catalog）。**日付を持たない行だけ**が並ぶので、種別（予約/抽選/発売）・
   * 時期（今週/今月）・「日付未定を隠す」は押しても必ず0件になる＝押せる空約束になる。
   * 出さない（0件のジャンルチップを押せなくしているのと同じ理由）。
   */
  catalog?: boolean;
};

export function FilterBar({ genres, values, onChange, onClear, locale = "ja", catalog = false }: Props) {
  // タブの value（フィルタの語彙）は言語に依らず同じ。文言だけ i18n の1箇所に置く。
  const t = UI[locale];
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
          placeholder={t.searchPlaceholder}
          className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-rose-500 dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          type="submit"
          className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700"
        >
          {t.searchButton}
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => onChange({ genre: "" })} className={chipClass(genre === "")}>
          {t.all}
        </button>
        {genres.map(({ genre: g, count }) => (
          // 件数は他の絞り込みを効かせた実数。0件のジャンルは押しても空振りなので押せなくする
          // （「押したら0件だった」という空約束を出さない）。
          <button
            key={g}
            disabled={count === 0 && genre !== g}
            onClick={() => {
              // どのジャンルが見られているかを解析できるようにイベント記録
              track("genre_select", { genre: g });
              logEvent("genre_select", g);
              onChange({ genre: g });
            }}
            className={chipClass(genre === g, count === 0 && genre !== g)}
          >
            {genreLabel(g, locale)}
            <span className="ml-1 opacity-60">{count}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {!catalog && (
        <div className="flex items-center gap-1.5">
          <span className="text-neutral-600 dark:text-neutral-400">{t.statusLabel}</span>
          {t.statusTabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => onChange({ status: tab.value })}
              className={pillClass(status === tab.value, tab.value === "lottery")}
            >
              {tab.label}
            </button>
          ))}
        </div>
        )}
        {!catalog && (
        <div className="flex items-center gap-1.5">
          <span className="text-neutral-600 dark:text-neutral-400">{t.whenLabel}</span>
          {t.whenTabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => onChange({ when: tab.value })}
              className={pillClass(when === tab.value, false)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        )}
        {!catalog && (
        <button
          onClick={() => onChange({ datedOnly: !datedOnly })}
          className={pillClass(datedOnly, false)}
        >
          {t.hideUndated}
        </button>
        )}
        {anyActive && (
          <button
            onClick={onClear}
            className="rounded-md px-3 py-1.5 text-neutral-600 underline-offset-2 hover:text-rose-600 hover:underline dark:text-neutral-400 dark:hover:text-rose-400"
          >
            {t.clearFilters}
          </button>
        )}
      </div>
    </div>
  );
}

function chipClass(active: boolean, empty = false): string {
  const base = "rounded-full border px-3 py-1.5 text-sm transition";
  if (active) return `${base} border-rose-600 bg-rose-600 text-white`;
  if (empty)
    return `${base} cursor-not-allowed border-neutral-200 bg-neutral-50 text-neutral-400 dark:border-neutral-800 dark:bg-neutral-900/50 dark:text-neutral-600`;
  return `${base} border-neutral-300 bg-white text-neutral-700 hover:border-rose-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200`;
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
