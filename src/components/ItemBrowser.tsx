"use client";

import { useEffect, useMemo, useState } from "react";
import { FilterBar, type FilterValues } from "./FilterBar";
import { ItemCard, type Item } from "./ItemCard";
import { filterItems, groupItemsByDate, type ItemStatus, type ItemWhen } from "@/lib/itemFilter";

// 全件（今後の予定＋日付未定）を一度だけ受け取り、以降のジャンル/種別/時期/検索の絞り込みと
// 「もっと見る」は全てブラウザ内で即時に処理する（サーバー往復ゼロ＝体感が速い）。
// 初期描画はサーバー側でもこの状態で行われるので初回表示・SEOはそのまま。
const PAGE_SIZE = 120;

type Props = {
  items: Item[]; // eventDate は ISO 文字列。発売日昇順(未定は末尾)で並んでいる前提。
  genres: { genre: string; count: number }[];
  initial: FilterValues;
  initialShow: number;
};

export function ItemBrowser({ items, genres, initial, initialShow }: Props) {
  const [values, setValues] = useState<FilterValues>(initial);
  const [show, setShow] = useState(initialShow);

  // トップは静的HTML（常に未絞り込み）で配信されるため、共有・リロードされた絞り込みURL
  // （?genre=・?q=・?status=・?when=・?dated=1・?show=N）はマウント後にクライアント側で
  // 復元する。サーバーで searchParams を読まずに済ませ、ページをキャッシュ可能に保つための対応。
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const rawStatus = sp.get("status") ?? "";
    const status =
      rawStatus === "reserve" || rawStatus === "lottery" || rawStatus === "release" || rawStatus === "now"
        ? rawStatus
        : "";
    const rawWhen = sp.get("when") ?? "";
    const when = rawWhen === "week" || rawWhen === "month" ? rawWhen : "";
    const restored: FilterValues = {
      genre: sp.get("genre") ?? "",
      query: sp.get("q") ?? "",
      status,
      when,
      datedOnly: sp.get("dated") === "1",
    };
    const parsedShow = Number.parseInt(sp.get("show") ?? "", 10);
    const restoredShow =
      Number.isFinite(parsedShow) && parsedShow > PAGE_SIZE ? parsedShow : PAGE_SIZE;
    const hasFilter =
      Boolean(restored.genre || restored.query || restored.status || restored.when || restored.datedOnly);
    // URL（外部システム）の状態をマウント後に一度だけ React 状態へ取り込む。SSR では window が
    // 無く、初期状態でこれを読むとハイドレーション不整合になるため effect で行う必要がある。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (hasFilter) setValues(restored);
    if (restoredShow > PAGE_SIZE) setShow(restoredShow);
  }, []);

  const filtered = useMemo(
    () =>
      filterItems(items, {
        genre: values.genre || undefined,
        query: values.query || undefined,
        status: (values.status || undefined) as ItemStatus | undefined,
        when: (values.when || undefined) as ItemWhen | undefined,
        datedOnly: values.datedOnly,
      }),
    [items, values]
  );

  const visible = filtered.slice(0, show);
  const remaining = filtered.length - visible.length;
  const groups = useMemo(() => groupItemsByDate(visible), [visible]);

  function syncUrl(next: FilterValues, nextShow: number) {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams();
    if (next.genre) p.set("genre", next.genre);
    if (next.query) p.set("q", next.query);
    if (next.status) p.set("status", next.status);
    if (next.when) p.set("when", next.when);
    if (next.datedOnly) p.set("dated", "1");
    if (nextShow > PAGE_SIZE) p.set("show", String(nextShow));
    const qs = p.toString();
    // Next のナビゲーションを起こさず URL だけ更新（共有・リロード保持のため）。
    window.history.replaceState(null, "", qs ? `/?${qs}` : "/");
  }

  function onChange(patch: Partial<FilterValues>) {
    const next = { ...values, ...patch };
    setValues(next);
    setShow(PAGE_SIZE); // 絞り込みが変わったら1ページ目に戻す
    syncUrl(next, PAGE_SIZE);
  }

  function onClear() {
    const cleared: FilterValues = { genre: "", query: "", status: "", when: "", datedOnly: false };
    setValues(cleared);
    setShow(PAGE_SIZE);
    syncUrl(cleared, PAGE_SIZE);
  }

  function loadMore() {
    const nextShow = show + PAGE_SIZE;
    setShow(nextShow);
    syncUrl(values, nextShow);
  }

  return (
    <>
      <div className="mb-6">
        <FilterBar genres={genres} values={values} onChange={onChange} onClear={onClear} />
      </div>

      {filtered.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-neutral-500">該当する商品が見つかりませんでした。</p>
          <button
            onClick={onClear}
            className="mt-4 inline-block rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition hover:border-rose-400 hover:text-rose-600 dark:border-neutral-700 dark:text-neutral-200"
          >
            絞り込みをリセット
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map((g) => (
            <section key={g.label}>
              <h2 className="mb-3 flex items-baseline gap-2 text-lg font-bold text-neutral-900 dark:text-neutral-50">
                {g.label}
                <span className="text-sm font-normal text-neutral-400">{g.items.length}</span>
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {g.items.map((item) => (
                  <ItemCard key={item.id} item={item} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {remaining > 0 && (
        <div className="mt-8 flex justify-center">
          <button
            onClick={loadMore}
            className="rounded-lg border border-neutral-300 bg-white px-6 py-2.5 text-sm font-semibold text-neutral-700 transition hover:border-rose-400 hover:text-rose-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
          >
            もっと見る（残り{remaining}件）
          </button>
        </div>
      )}
    </>
  );
}
