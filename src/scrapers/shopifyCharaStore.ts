import { ScrapedItem } from "./types";
import { fetchHtml, fetchShopifyProducts, sleep, type ShopifyProduct } from "./util";
import { calendarDate, todayJst } from "../lib/date";

// 「日付別コレクション」方式の Shopify キャラクターグッズ公式ストアの共通実装。
//
// ちいかわマーケット（2026-08-18）で確立した取り方を、ナガノマーケット・mofusand
// もふもふマーケット（2026-08-21 調査で**3店とも同じ運用**と実測）に横展開する。
// 同じ流れを3ファイルにコピーしない＝直すときに1箇所で済ませる（crawlPages と同じ思想）。
//
// 方式: トップページに `/collections/pre20260826`（予約）`/collections/20260807`（発売）
// `/collections/re20260807`（再入荷）の日付別コレクションが常設され、商品は Shopify の
// 公開JSON（/collections/<handle>/products.json）で構造化されたまま取れる。

/** トップページから日付別コレクションの handle を拾う。
 *  mofusand は suffix 型（`20251010re`）や枝番（`20251128-2`）も使う（実測）。 */
export const DATED_COLLECTION_HREF_RE = /\/collections\/((?:pre|re)?\d{8}(?:re)?(?:[-_][\w-]*)?)\b/g;

export type DatedCollection = { handle: string; kind: "発売" | "予約" | "再販"; date: Date | null };

/**
 * コレクション handle を「種別＋日付」に読み替える（純関数・selftest対象）。
 *   `20260807`    … 8月7日発売
 *   `pre20260724` … 7月24日予約開始
 *   `re20260805` / `20251010re` … 再入荷
 *   `20251128-2` / `20250124-plush` … 同日の枝番（種別・日付は同じ）
 */
export function parseDatedCollectionHandle(handle: string): DatedCollection | null {
  const m = handle.match(/^(pre|re)?(\d{4})(\d{2})(\d{2})(re)?(?:[-_][\w-]*)?$/);
  if (!m) return null;
  const month = Number(m[3]);
  const day = Number(m[4]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const kind = m[1] === "pre" ? "予約" : m[1] === "re" || m[5] === "re" ? "再販" : "発売";
  return { handle, kind, date: calendarDate(Number(m[2]), month, day) };
}

/**
 * 商品タイトルの運用ノイズを剥がす（純関数・selftest対象）。
 *
 * ナガノマーケットは「【予約】〜【2026年12月中旬より順次発送予定（発送延期の場合も
 * キャンセル不可となります）】」のように、種別と発送規約をタイトルに埋め込む（実測）。
 * 種別は eventType が持つ・発送時期は eventDateText に移すので、タイトルには残さない。
 * 返り値: [整形後タイトル, 剥がした発送注記（無ければ null）]
 */
export function splitCharaStoreTitle(raw: string): [string, string | null] {
  let t = raw.replace(/\s+/g, " ").trim();
  t = t.replace(/^【(?:予約|再販|再入荷|新商品|受注)】\s*/, "");
  let shipping: string | null = null;
  // 末尾の【…】のうち、運用注記（発送・配送・キャンセル規約等）を**連続で**剥がす
  // （実測: ナガノは「…【発送規約】【同時購入不可】【キャンペーン対象外】」と3連続で付く）。
  // 商品名の一部の【】（注記語を含まないもの）は残す。
  const NOTE_WORDS = /発送|お届け|配送|キャンセル|同時購入|キャンペーン対象|返品|購入制限/;
  for (;;) {
    const m = t.match(/【([^【】]*)】\s*$/);
    if (!m || m.index === undefined || !NOTE_WORDS.test(m[1])) break;
    // 発送時期を含む注記は eventDateText として残す（捨てない）
    if (!shipping && /発送|お届け/.test(m[1])) shipping = m[1].trim() || null;
    t = t.slice(0, m.index).trim();
  }
  return [t.length >= 2 ? t : raw.trim(), shipping];
}

/** 商品タイプ＋タイトル → サイトのジャンル語彙（itemFilter.ts の GENRE_ORDER が唯一の定義）。
 *  キャラクターグッズ店なので「ぬいぐるみ」をフィギュアに倒さない（classifyGenre との違い）。 */
export function charaStoreGenre(productType: string, title: string): string {
  const t = `${productType} ${title}`;
  if (/ソフビ/.test(t)) return "ソフビ・アートトイ";
  if (/フィギュア/.test(t)) return "フィギュア";
  return "キャラグッズ";
}

export type CharaStoreConfig = {
  source: string;
  /** 例: "https://nagano-market.jp"（末尾スラッシュなし） */
  store: string;
  /** 発売日を過ぎた行を何日残すか（発売日当日は「今日発売」として見せたい） */
  keepDaysAfterRelease?: number;
  /** ジャンル判定（省略時は charaStoreGenre） */
  genre?: (productType: string, title: string) => string;
};

function toItem(cfg: CharaStoreConfig, p: ShopifyProduct, kind: "発売" | "予約" | "再販", date: Date | null): ScrapedItem {
  const [title, shipping] = splitCharaStoreTitle(p.title);
  const yen = Number(p.variants?.[0]?.price ?? 0);
  return {
    source: cfg.source,
    sourceId: p.handle,
    title,
    genre: (cfg.genre ?? charaStoreGenre)(p.product_type ?? "", title),
    subGenre: null,
    eventType: kind,
    eventDate: date,
    eventDateText: shipping,
    price: yen ? `${yen.toLocaleString()}円` : null,
    url: `${cfg.store}/products/${p.handle}`,
    imageUrl: p.images?.[0]?.src ?? null,
  };
}

export async function scrapeCharaShopifyStore(cfg: CharaStoreConfig): Promise<ScrapedItem[]> {
  const today = todayJst();
  const cutoff = today.getTime() - (cfg.keepDaysAfterRelease ?? 0) * 86_400_000;

  // トップに出ている日付別コレクションを列挙する（＝収集元が今見せている全部）。
  // 「トップ＝全部」と仮定せず、実際に並んでいるものを毎回読み直す。
  let handles: string[] = [];
  try {
    const top = await fetchHtml(`${cfg.store}/`);
    handles = [...new Set([...top.matchAll(DATED_COLLECTION_HREF_RE)].map((m) => m[1]))];
  } catch {
    handles = [];
  }

  const byId = new Map<string, ScrapedItem>();

  // ① 日付が確定しているコレクション（発売日／予約開始日／再入荷日）。
  for (const handle of handles) {
    const col = parseDatedCollectionHandle(handle);
    if (!col?.date) continue;
    // 過ぎたコレクションは、入れても表示側で落ちる（eventDate < today）。巡回の無駄を省く。
    if (col.date.getTime() < cutoff) continue;
    let products: ShopifyProduct[];
    try {
      products = await fetchShopifyProducts(cfg.store, handle);
    } catch {
      continue;
    }
    await sleep(400);
    for (const p of products) {
      if (!byId.has(p.handle)) byId.set(p.handle, toItem(cfg, p, col.kind, col.date));
    }
  }

  // ② 新着・再入荷（日付なし＝「いま買える」速報）。
  // **在庫があるものだけ**入れる。売り切れを「発売」として日付なしで並べると、
  // 押した先が品切れ＝行き止まりになる（[[UIラベルは裏取り済みのみ約束]]）。
  for (const [handle, kind] of [
    ["newitems", "発売"],
    ["restock", "再販"],
  ] as const) {
    let products: ShopifyProduct[];
    try {
      products = await fetchShopifyProducts(cfg.store, handle);
    } catch {
      continue;
    }
    await sleep(400);
    for (const p of products) {
      if (byId.has(p.handle)) continue;
      if (!p.variants?.some((v) => v.available)) continue;
      byId.set(p.handle, toItem(cfg, p, kind, null));
    }
  }

  return [...byId.values()];
}
