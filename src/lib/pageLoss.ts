/**
 * 「ページから商品が減ったこと」を、**理由まで分けて**扱うための純関数。
 *
 * なぜ件数の割合では足りないか（2026-08-09 実測）:
 * 「2割以上減ったら WARN」という閾値の検査が、`/genre/スニーカー` の 25→18件（-28%）で
 * ERROR を出した。中身を見たら **8/7・8/8 発売のスニーカー10件が今日になって過去日に
 * なっただけ**で、コードもデータも壊れていない。スニーカーは発売日＝当日消える商品なので、
 * 毎日この規模で自然に減る。つまりこの閾値は、この面では**毎日鳴り続ける誤報**だった。
 * 正常を故障と鳴らす検査は、いずれ誰も読まなくなる（[[System/rules]]）。
 *
 * かといって閾値を緩めるのは逆効果で、この検査が生まれた事件（/premium を自分のコード変更で
 * 63→36件に削ったのに素通りした）を取り逃がす。**必要なのは閾値の調整ではなく、
 * 「暦のせいで減った分」と「説明のつかない減り方」を分けること。**
 *
 * 分け方:
 *   ・DBから消えた         … 収集元が記事を落とした＝こちらの問題ではない
 *   ・日付が過ぎた         … 過去日を載せないページでは、暦が進めば必ず抜ける
 *   ・上記以外（unexplained）… まだ未来／日付未定なのに消えた＝掲載基準・重複解消・
 *                            コード変更のいずれかが削った。**これだけを指摘する。**
 *
 * ※ `/premium`（プレ値ランキング）と `/release/*`（月ページ）は**過去も意図して載せる**ので、
 *   「日付が過ぎた」は消える理由にならない。ここを取り違えると、まさに /premium の事件を
 *   「暦のせい」と誤って説明して見逃すことになる。
 */

import { isStalePlan } from "./date";
import { productUrlKey } from "./itemFilter";
import { saleUnitLabel, stripSaleUnit } from "./saleUnit";
import { cleanListTitle } from "./title";

/**
 * 「代表に畳まれた」ことを示す突合キー。ページ内の表示行と消えた行で**同じ物差し**を使う。
 *
 * 2系統ある:
 *  ① 商品ページURL＋暦日 … `dedupeSameProductUrlCrossSource` が畳んだ分
 *  ② 収集元＋単位表記を外した名前＋暦日 … `dedupeSaleUnitSameSource` が畳んだ分
 *     （実測 2026-08-18: 販売単位の重複解消を入れた直後、`/tcg/ヴァイスシュヴァルツ` の
 *      18→14件が「説明のつかない消失」で ERROR になった。畳んだのはこちらなのに、
 *      説明する側がその理由を知らなかった＝検査側の説明不足）。
 *
 * `displayed`（＝そのページに今出ている行）と、消えた行とで出すキーが少し違う:
 *  ・消えた行は**単位表記を持つときだけ**②を出す（畳まれる側は単位表記付きの行）。
 *  ・日付なしの行は暦日の代わりに `-` で揃える（単位違いは日付なしの行が混ざる）。
 */
export function productMergeKeys(
  r: {
    url?: string | null;
    officialUrl?: string | null;
    eventDate: Date | string | null;
    eventDateText?: string | null;
    source?: string | null;
    title?: string | null;
  },
  displayed = false
): string[] {
  const keys: string[] = [];
  const day = r.eventDate ? new Date(r.eventDate).toISOString().slice(0, 10) : null;
  if (day) {
    for (const k of [productUrlKey(r.url), productUrlKey(r.officialUrl)]) if (k) keys.push(`${k}|${day}`);
  }
  if (r.source && r.title && (displayed || saleUnitLabel(cleanListTitle(r.source, r.title)))) {
    const base = stripSaleUnit(cleanListTitle(r.source, r.title));
    if (base.length >= 8) {
      const d = day ?? r.eventDateText ?? null;
      if (displayed) {
        keys.push(`unit|${r.source}|${base}|-`);
        if (d) keys.push(`unit|${r.source}|${base}|${d}`);
      } else {
        keys.push(`unit|${r.source}|${base}|${d ?? "-"}`);
      }
    }
  }
  return keys;
}

/** そのページが「過去日の商品を載せない」設計か。 */
export function pageExcludesPast(name: string): boolean {
  return name !== "/premium" && !name.startsWith("/release/");
}

export type LostRow = {
  id: number;
  /** DBに今も存在するか（収集元から消えた行は false）。 */
  inDb: boolean;
  eventDate: Date | string | null;
  /**
   * 「2026年06月04週登場予定」のような**日付未確定のまま書かれた予定**。
   *
   * これを見ないと、`dropStalePlans`（掲載基準）が過ぎた予定を外した行が、eventDate=null の
   * ため一律「説明がつかない」に入る。実測 2026-08-11: `audit:tomorrow` で暦を+30日進めたら
   * `/genre/フィギュア` の43件がこの型で「説明のつかない消失」に化けた（暦が進んだだけ）。
   */
  eventDateText?: string | null;
  /** 突合（productMergeKeys）に使う。渡せる呼び出しだけ渡せばよい（任意）。
   *  source/title は**販売単位の重複解消**に畳まれた行を説明するのに要る。 */
  url?: string | null;
  officialUrl?: string | null;
  source?: string | null;
  title?: string | null;
};

export type PageLoss = {
  /** 収集元から消えた。 */
  gone: number;
  /** 日付が過ぎて自然に抜けた（過去日を載せないページのみ）。 */
  expired: number;
  /** 同じ商品ページを指す別カードに畳まれた（URL重複の解消＝カードは今もページにある）。 */
  merged: number;
  /**
   * このページからは消えたが、**サイトの別の面にはまだ出ている**＝ページ間の移動。
   *
   * 実測 2026-08-18: `/release/2026-11` が 57→54件で ERROR。中身はサントリーの
   * ウイスキー抽選3件で、**受付中ストアが増えて最も近い日が11月→8/18に変わった**ため
   * 8月の月ページへ移っただけだった（3件とも今も表示中）。情報は1件も失われていないのに
   * 「説明のつかない消失」に入っていた＝**検査側の説明不足**（データは壊れていない）。
   *
   * 月ページの所属は eventDate から、ジャンルページの所属は genre から決まるので、
   * その値が正当に変われば必ずこの形の「減少」が出る。**移動は消失ではない。**
   * ただし黙って消さず件数で出す（全部が「移動」に化けたら、それ自体が異常の合図）。
   */
  moved: number;
  /** 説明がつかない＝掲載基準・重複解消・コード変更が削った id。 */
  unexplained: number[];
};

export function classifyPageLoss(
  page: string,
  removed: LostRow[],
  today: Date,
  /** そのページに**今表示されている**行の productMergeKeys の集合。消えた行のキーが
   *  ここにあれば「代表に畳まれた」＝商品はまだページにある（2026-08-15 のURL重複解消で、
   *  負け側5件が「説明のつかない消失」と誤って鳴った型への対処）。 */
  displayedMergeKeys?: Set<string>,
  /** サイトの**いずれかの面に今表示されている** id の集合（全ページの和集合）。
   *  ここに居るなら、このページから消えたのは移動であって消失ではない。 */
  stillDisplayedIds?: Set<number>
): PageLoss {
  const excludesPast = pageExcludesPast(page);
  const out: PageLoss = { gone: 0, expired: 0, merged: 0, moved: 0, unexplained: [] };
  for (const r of removed) {
    if (!r.inDb) {
      out.gone++;
      continue;
    }
    if (excludesPast && r.eventDate && new Date(r.eventDate).getTime() < today.getTime()) {
      out.expired++;
      continue;
    }
    // 日付未確定でも、本文の予定日が過ぎていれば掲載基準（dropStalePlans）が外す。
    // 判定は掲載基準と同じ関数を使う＝**外す側と説明する側で別の物差しを持たない**。
    if (excludesPast && isStalePlan(r.eventDate ?? null, r.eventDateText ?? null, today)) {
      out.expired++;
      continue;
    }
    if (displayedMergeKeys?.size && productMergeKeys(r).some((k) => displayedMergeKeys.has(k))) {
      out.merged++;
      continue;
    }
    // 最後に見る。上の3つ（収集元から消えた／日付切れ／畳まれた）の方が理由として具体的なので、
    // それらを「移動」で覆い隠さない。
    if (stillDisplayedIds?.has(r.id)) {
      out.moved++;
      continue;
    }
    out.unexplained.push(r.id);
  }
  return out;
}

/**
 * 指摘に値する「説明のつかない減少」か。
 *
 * ・代表の入れ替え（重複解消で残す側が変わる）は、片方が抜けて片方が入るので **総数は減らない**。
 *   これを鳴らすと毎回1〜2件の雑音になるので、**実際に減った数を上限**にする。
 * ・小さすぎる変動は見ない（3件未満／5%未満）。/premium の事件は 27件・43% なので確実に鳴る。
 */
export function isReportableLoss(prevCount: number, nowCount: number, unexplained: number): number {
  const net = prevCount - nowCount;
  if (net <= 0) return 0;
  const effective = Math.min(unexplained, net);
  if (effective < 3 || effective < prevCount * 0.05) return 0;
  return effective;
}

/**
 * **ページが丸ごと消えた**ことを指摘するか（audit.ts (14a)）。
 *
 * 減少（isReportableLoss）と違って件数の下限を置かない。ページが消えるのは全滅であり、
 * 「小さすぎる変動」は無いから。分けるのは理由だけ:
 *
 * ・在籍1件のジャンルは、その1件が過去日になれば必ずページごと消える（実測 2026-08-11:
 *   `/genre/ソフビ・アートトイ` が #23086 の8/10開催で消えた）。暦が進んだだけなので鳴らさない。
 * ・まだ未来／日付未定の行が残っているのにページが消えたなら、削ったのは掲載基準かコード。
 *   これは /premium の事件と同じ型なので鳴らす。
 * ・直前の実行の記録が無ければ理由を出せない。**説明できないものは通さない**ので鳴らす。
 */
/**
 * ページ別「説明のつかない消失」の累計を進める（audit-profile.json に持つ値）。
 *
 * なぜ累計が要るか: 基準比の急減を見る検査 (14) は数日〜数週間前の基準と比べるので、
 * 1回の実行の内訳だけでは「暦で減ったのか、こちらが削ったのか」を言えない。**説明のつかない
 * 分だけ**を足し続ければ、毎日少しずつ削る型（1日ごとの閾値の下をすり抜ける）も残る。
 *
 * `accepted`（--update-baseline＝今の状態を受け入れた）で0に戻す。基準が変わったのに累計だけ
 * 残ると、受け入れたはずの減少で永久に鳴り続ける＝消せない警告になる。
 */
export function accumulateUnexplained(
  prev: Record<string, number>,
  today: Record<string, number>,
  accepted: boolean
): Record<string, number> {
  if (accepted) return {};
  const out = { ...prev };
  for (const [name, n] of Object.entries(today)) out[name] = (out[name] ?? 0) + n;
  return out;
}

export function isReportableVanish(hasPrevRecord: boolean, unexplained: number): boolean {
  if (!hasPrevRecord) return true;
  return unexplained > 0;
}
