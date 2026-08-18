/**
 * 「同じ商品なのに、**販売単位**が違うだけで別カードになる」を1枚に畳むための純関数。
 *
 * 直す対象（2026-08-18 実測・本人指摘の続き）: 同じページに同じ商品が2枚並ぶ組が10組あり、
 * 中身は全部「単位だけが違う行」だった。
 *   ・トレカ速報 8組 … 『葬送のフリーレン Vol.2』(440円) ↔ 『同 【10パック入りBOX】』(4,400円)
 *   ・タカラトミーモール … 『ホロビート』↔『【BOX販売】』↔『【カートン買いセット】』
 *   ・ガシャポン … 『【箱売】機動戦士ガンダム MSメカニカルバストDX…』↔ 単体
 * 発売日も商品も同じで、違うのは買う量だけ。一覧に2枚並べても読む側は同じものを2回見るだけ。
 *
 * **ただし畳んで消してはいけない。** 単位ごとに**価格も購入導線も別**（440円/4,400円で別記事）。
 * 片方を落とすだけだと、その単位で買う人の導線が消える。カードは1枚にまとめ、
 * **単位の一覧は商品ページの中に出す**（＝[[UIラベルは裏取り済みのみ約束]]。表に出すのは
 * 収集元が書いた単位表記と価格だけで、こちらは何も推定しない）。
 *
 * **「単品」と書かない理由**: 単位表記の無い行が1パックとは限らない。実測で
 * 『【Z/X】アセンション・サマー [IG15]』は 6,600円＝1BOX で、相方が [1カートン] 79,200円だった
 * （440円↔4,400円の組と同じ形なのに中身は BOX↔カートン）。**どちらが小さいかは数えられない**
 * ので、ラベルは収集元の表記のまま出し、無い行には商品名をそのまま出す。
 */

/**
 * タイトルに書かれた販売単位の括弧（実データから作った・決め打ちしない）。
 * 実測の全パターン: 【10パック入りBOX】(20件) / (BOX=8)(3件) / [1カートン] / 【1BOX:14パック入】 /
 * 【カートン買いセット】 / 【BOX販売】 / 【箱売】。
 *
 * `箱` 単体を入れていないのは、`【箱ver.】サンリオキャラクターズ おおきなSOFVIMATES～`
 * のような**版の名前**を単位と読み違えるため（あれは畳んではいけない別商品）。
 */
const SALE_UNIT_RE =
  /[【[（(][^】\])）]*(?:BOX|ＢＯＸ|カートン|箱売|パック入)[^】\])）]*[】\])）]/gi;

/** タイトルに単位表記があればその中身（括弧を外した文字列）。無ければ null。 */
export function saleUnitLabel(title: string): string | null {
  const m = title.match(SALE_UNIT_RE);
  if (!m?.length) return null;
  return m[0].replace(/^[【[（(]|[】\])）]$/g, "").trim() || null;
}

/** 単位表記を落とした商品名。**落とした結果が短すぎるときは元のまま返す**
 *  （名前がほぼ単位表記だけの行を、別商品と束ねてしまわないため）。 */
export function stripSaleUnit(title: string): string {
  const t = title.replace(SALE_UNIT_RE, " ").replace(/\s+/g, " ").trim();
  return t.length >= 8 ? t : title;
}

export type SaleUnitRow = {
  id: number;
  source: string;
  title: string;
  price: string | null;
  url: string | null;
  eventDate: Date | string | null;
  eventDateText?: string | null;
};

/** 突合用の正規化（空白・記号・全角半角・大小を吸収）。
 *  実測: トレカ速報が同じ商品を「GX トレーディング」「GXトレーディング」と**空白違い**で
 *  載せており、生の文字列で突合すると単位違いの3組が残った。
 *  ※ itemFilter の dedupeKey と同じ考え方だが、あちらは saleUnit を import しているので
 *    こちらから import すると循環になる（productUrlKey と同じ理由でローカル実装）。 */
function normalizeName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　]+/g, "")
    .replace(/[「」『』【】[\]()（）・、。！!？?~〜"'“”‘’＂＇-]/g, "");
}

/** その行の「同じ回か」を表す日付キー。暦日 → 文言 → 無ければ null（＝日付不明）。 */
function dayKey(r: SaleUnitRow): string | null {
  if (r.eventDate) return new Date(r.eventDate).toISOString().slice(0, 10);
  return r.eventDateText ?? null;
}

/**
 * 同じ収集元の行を「単位違いの組」に分ける（組にならない行は返さない）。
 *
 * **日付なしの行を捨てない。** 実測: トレカ速報の `…アクリルスタンド(BOX=8)` 3件は
 * eventDate も eventDateText も無く、相方（8/31発売）と束ねられずに一覧へ2枚並んでいた。
 * 同じ名前で日付が1つしか無い組なら、日付なしは**その回のBOX表記**とみなして束ねる
 * （`dedupeIdenticalTitle` の「月未定だった頃の記事」と同じ考え方）。
 * 日付が2つ以上ある組（＝再販などで別の回がある）では、どの回か分からないので束ねない。
 */
export function groupSaleUnits<T extends SaleUnitRow>(
  rows: T[],
  cleanTitle: (r: T) => string
): T[][] {
  const buckets = new Map<string, T[]>();
  for (const r of rows) {
    const base = normalizeName(stripSaleUnit(cleanTitle(r)));
    if (base.length < 8) continue;
    const k = `${r.source}|${base}`;
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(r);
  }
  const out: T[][] = [];
  for (const b of buckets.values()) {
    if (b.length < 2) continue;
    const days = new Set(b.map(dayKey).filter((d): d is string => d !== null));
    const candidates: T[][] =
      days.size <= 1
        ? [b] // 日付が1つ以下＝同じ回。日付なしも一緒に束ねる
        : [...days].map((d) => b.filter((r) => dayKey(r) === d)); // 別の回は混ぜない
    for (const g of candidates) {
      if (isSaleUnitGroup(g.map((r) => ({ title: cleanTitle(r) })))) out.push(g);
    }
  }
  return out;
}

/**
 * その組を「単位違い」として畳んでよいか。
 * **1つでも単位表記を持つ行があること**が条件。全部が同じ顔（表記なし同士）なら、それは
 * 単位違いではなく別の重複（同名の別記事など）なので、この関数は手を出さない。
 */
export function isSaleUnitGroup(rows: { title: string }[]): boolean {
  if (rows.length < 2) return false;
  const labels = rows.map((r) => saleUnitLabel(r.title));
  return labels.some((l) => l !== null) && new Set(labels).size === labels.length;
}

export type SaleUnit = { id: number; label: string; price: string | null; url: string | null };

/**
 * 商品ページに出す単位の一覧。ラベルは**収集元が書いた単位表記**、無い行は商品名そのもの。
 * 並びは価格の安い順（読む人が量の小さい方から見る）。価格が読めない行は最後。
 */
export function buildSaleUnits(rows: SaleUnitRow[], cleanTitle: (r: SaleUnitRow) => string): SaleUnit[] {
  const yen = (p: string | null) => {
    const n = p?.replace(/,/g, "").match(/\d+/)?.[0];
    return n ? Number(n) : Number.POSITIVE_INFINITY;
  };
  return rows
    .map((r) => ({
      id: r.id,
      label: saleUnitLabel(r.title) ?? cleanTitle(r),
      price: r.price,
      url: r.url,
    }))
    .sort((a, b) => yen(a.price) - yen(b.price) || a.id - b.id);
}
