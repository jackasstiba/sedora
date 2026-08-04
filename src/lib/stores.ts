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
