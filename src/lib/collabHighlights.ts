// コラボ行の `highlights`（注目グッズの要約）の**書式の唯一の定義**。
//
// なぜ1ファイルに閉じるか: この文字列は `src/scrapers/collaboEnrich.ts` が組み立て、
// 表示層（英語版）が読み解く。**組み立てと読み解きが別々の場所に書かれていると、片方を
// 直した日にもう片方が黙って壊れる**（日付を `src/lib/date.ts` に閉じたのと同じ理由）。
// 書式を変えるときはここだけを変え、audit:selftest の往復テストで両方向を固定する。
//
// 書式:
//   "抽選・くじあり ｜ 登場グッズ: A / B ｜ 公式販売: アクリルスタンド¥880〜¥1,540 / 缶バッジ¥550"
//   - 仕組み（任意・3種のいずれか1つ）
//   - 登場グッズ（任意・本文に出てきたグッズ名。**賞品だとは断定しない**中立表現）
//   - 公式販売（任意・公式ページで実際に商品名と価格を取得できたときだけ）
import { goodsLabel } from "./i18n";

/** せどらーが狙う注目グッズの名詞（閉じた語彙）。長い複合語を先に並べ、短い語が
 *  複合語に内包される場合は複合語を優先する（「マフラータオル」＞「タオル」）。
 *  英語ラベルは src/lib/i18n.ts の GOODS_LABELS_EN と対（対応が無い語は日本語のまま出す）。 */
export const GOODS_NOUNS = [
  "マフラータオル", "フェイスタオル", "バスタオル", "タオル",
  "アクリルスタンド", "アクリルキーホルダー", "アクスタ",
  "トレーディングカード", "ブロマイド", "ポストカード", "ポスター",
  "ぬいぐるみ", "フィギュア", "ねんどろいど",
  "缶バッジ", "ピンバッジ", "バッジ",
  "ラバーストラップ", "アクリルチャーム", "チャーム", "キーホルダー",
  "クリアファイル", "ステッカー", "シール", "コースター",
  "タペストリー", "色紙", "マグカップ", "グラス",
  "ポーチ", "巾着", "トレカ", "カード",
];

/** 仕組みの見出し（本文で検証できた事実のみ。優先は 抽選 > ランダム > 数量限定）。 */
export const COLLAB_MECHANISMS = {
  lottery: "抽選・くじあり",
  random: "ランダム(ブラインド)封入",
  scarcity: "数量限定・受注",
} as const;

export type CollabMechanism = keyof typeof COLLAB_MECHANISMS;

export const GOODS_PREFIX = "登場グッズ: ";
export const OFFICIAL_SALE_PREFIX = "公式販売: ";
export const HIGHLIGHT_SEP = " ｜ ";

export type ParsedHighlights = {
  mechanism: CollabMechanism | null;
  /** 本文に出てきたグッズ名（価格なし） */
  goods: string[];
  /** 公式ページで名前と価格が取れたもの */
  sale: { noun: string; price: string }[];
};

/** 要約文字列を組み立てる（collaboEnrich が使う）。全部空なら null。 */
export function buildHighlights(parts: {
  mechanism: CollabMechanism | null;
  goods: string[];
  saleText?: string | null;
}): string | null {
  const segments = [
    parts.mechanism ? COLLAB_MECHANISMS[parts.mechanism] : null,
    parts.goods.length ? `${GOODS_PREFIX}${parts.goods.join(" / ")}` : null,
    parts.saleText ?? null,
  ].filter(Boolean);
  return segments.length ? segments.join(HIGHLIGHT_SEP) : null;
}

/**
 * 要約文字列を構造に戻す。**コラボの書式でないものは null**（他ソースの highlights は
 * 「受付中ストア：…」「各賞：…」等の別の書式で、ここで読み解いてはいけない）。
 */
export function parseHighlights(highlights: string | null | undefined): ParsedHighlights | null {
  if (!highlights) return null;
  const segments = highlights.split(HIGHLIGHT_SEP).map((s) => s.trim()).filter(Boolean);
  let mechanism: CollabMechanism | null = null;
  const goods: string[] = [];
  const sale: { noun: string; price: string }[] = [];
  let matched = false;

  for (const seg of segments) {
    const mech = (Object.keys(COLLAB_MECHANISMS) as CollabMechanism[]).find(
      (k) => COLLAB_MECHANISMS[k] === seg
    );
    if (mech) {
      mechanism = mech;
      matched = true;
      continue;
    }
    if (seg.startsWith(GOODS_PREFIX)) {
      goods.push(...seg.slice(GOODS_PREFIX.length).split(" / ").map((s) => s.trim()).filter(Boolean));
      matched = true;
      continue;
    }
    if (seg.startsWith(OFFICIAL_SALE_PREFIX)) {
      for (const part of seg.slice(OFFICIAL_SALE_PREFIX.length).split(" / ")) {
        const t = part.trim();
        // 「アクリルスタンド¥880〜¥1,540」＝ 最初の ¥ の手前までが名前（名前に ¥ は出てこない）。
        const at = t.indexOf("¥");
        if (at <= 0) continue;
        sale.push({ noun: t.slice(0, at).trim(), price: t.slice(at).trim() });
      }
      matched = true;
      continue;
    }
  }
  return matched ? { mechanism, goods, sale } : null;
}

/**
 * カード用の**1行英語要約**。読み解けない書式では null（＝呼び出し側が原文のまま出す）。
 *
 * 詳細ページと同じ材料を、カードに収まる長さで並べるだけ。**新しい事実を足さない**
 * （買える・当たる・海外に送れる、はどこにも書かない）。訳すのは種別名だけ。
 */
export function summarizeHighlightsEn(highlights: string | null | undefined): string | null {
  const parsed = parseHighlights(highlights);
  if (!parsed) return null;
  const parts: string[] = [];
  if (parsed.mechanism) parts.push(MECHANISM_SHORT_EN[parsed.mechanism]);
  // 価格つきが取れているならそちらを優先（読者にとって情報量が多い）。
  if (parsed.sale.length) {
    parts.push(parsed.sale.map((s) => `${goodsLabelEn(s.noun)} ${s.price}`).join(" · "));
  } else if (parsed.goods.length) {
    parts.push(parsed.goods.map(goodsLabelEn).join(" · "));
  }
  return parts.length ? parts.join(" — ") : null;
}

/** カード要約用の短い仕組みラベル（詳細ページの文（COLLAB_MECHANISM_EN）より短く）。 */
const MECHANISM_SHORT_EN: Record<CollabMechanism, string> = {
  lottery: "Lottery / kuji",
  random: "Blind box",
  scarcity: "Limited / made-to-order",
};

/** 種別名の英語（対応が無ければ日本語のまま）。i18n.ts の表を使う。 */
function goodsLabelEn(noun: string): string {
  return goodsLabel(noun, "en");
}
