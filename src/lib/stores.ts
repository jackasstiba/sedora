// 家電・ゲーム機など「複数の小売が同時に抽選/予約応募を実施する」商品の、
// 現在“受付中”の公式ストア一覧（Item.stores JSON列）を安全にパースする純関数。
// 各エントリは一次ソース（各小売の抽選ページ）へ直リンクし、アグリゲーターは表に出さない。

export type StoreEntry = {
  name: string; // 小売名（例: "Amazon", "ノジマオンライン"）
  url: string; // その小売の公式・抽選/応募ページ（一次ソース）
  form: string | null; // 販売形式（例: "抽選販売", "招待制販売", "予約"）
  when: string | null; // 受付・開始・締切の表示用テキスト（例: "9/5 17:00〜", "〜8/10"）
  note: string | null; // 応募条件（購入履歴・会員登録など＝当落を左右する“せどりの肝”）
};

/**
 * 表示用のラベル（店名＋形式＋受付時刻）でまとめる。
 *
 * 同じ小売が**別々の応募ページを複数開く**ことがある（実測: お宝創庫が同時刻に2口、
 * サントリー公式が山崎と白州で別ページ）。データとしては別物だが、そのまま並べると
 * 「お宝創庫・プレイズ（8/6 12:00〜）、お宝創庫・プレイズ（8/6 12:00〜）」と
 * **同じ文字列が2回並ぶだけ**で、読む側には区別がつかない（人間なら一瞬で気付く粗）。
 * ラベルが同じものは1つにまとめ、口数を添えて事実として区別できるようにする。
 */
export type StoreGroup = { label: string; entries: StoreEntry[] };

export function groupStoresByLabel(stores: StoreEntry[]): StoreGroup[] {
  const groups = new Map<string, StoreGroup>();
  for (const s of stores) {
    const label = `${s.name}|${s.form ?? ""}|${s.when ?? ""}`;
    const g = groups.get(label) ?? { label, entries: [] };
    g.entries.push(s);
    groups.set(label, g);
  }
  return [...groups.values()];
}

/** カード/一覧に出す短い要約（先頭 max 件＋「他N店」）。同一ラベルは「・N口」にまとめる。 */
export function summarizeStores(stores: StoreEntry[], max = 3): string {
  const groups = groupStoresByLabel(stores);
  const head = groups
    .slice(0, max)
    .map((g) => {
      const s = g.entries[0];
      const parts = [s.form, s.when].filter(Boolean);
      if (g.entries.length > 1) parts.push(`${g.entries.length}口`);
      return `${s.name}${parts.length ? `（${parts.join("・")}）` : ""}`;
    })
    .join("、");
  const rest = groups.length - Math.min(groups.length, max);
  return `${head}${rest > 0 ? ` 他${rest}店` : ""}`;
}

/** Item.stores（JSON配列文字列）を安全にパースする。壊れていれば null。 */
export function parseStoresJson(json: string | null | undefined): StoreEntry[] | null {
  if (!json) return null;
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const rows = arr
      .filter((s) => s && typeof s.name === "string" && typeof s.url === "string")
      .map(
        (s): StoreEntry => ({
          name: s.name,
          url: s.url,
          form: typeof s.form === "string" && s.form ? s.form : null,
          when: typeof s.when === "string" && s.when ? s.when : null,
          note: typeof s.note === "string" && s.note ? s.note : null,
        })
      );
    return rows.length ? rows : null;
  } catch {
    return null;
  }
}
