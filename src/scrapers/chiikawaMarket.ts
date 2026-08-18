import { ScrapedItem } from "./types";
import { fetchHtml, fetchShopifyProducts, sleep, type ShopifyProduct } from "./util";
import { calendarDate, todayJst } from "../lib/date";

// ちいかわマーケット（公式グッズショップ）＝**ちいかわの一次情報**。
//
// なぜ足したか（2026-08-18 実測）: 本番3512件に「ちいかわ」は29件あったが、**全部が
// まとめ記事・コラボ記事経由**（figisland/channeltono/collabo_cafe/koretore）で、
// 公式ショップの発売・再入荷そのものは1件も無かった。ちいかわは発売即完売→二次流通が
// 常時動く定番なので、「何が・いつ・定価いくらで出るか」を一次で持っていないのは痛い。
//
// 取得方式: Shopify の公開商品JSON（/collections/<handle>/products.json）。
// テーマのclass名を追うより壊れにくく、価格・在庫・タグ・画像が構造化されたまま取れる。
//
// 【掲載方針】url は公式ショップの商品ページ（一次情報）＝直リンクしてよい。

const STORE = "https://www.chiikawamarket.jp";

/** トップに常設される日付別コレクション（`/collections/20260807` 等）を拾う。 */
const DATED_COLLECTION_RE = /\/collections\/((?:pre|re)?\d{8})\b/g;

/** 発売日が過ぎた行を何日残すか（発売日当日は「今日発売」として見せたい）。 */
const KEEP_DAYS_AFTER_RELEASE = 0;

export type ChiikawaCollection = { handle: string; kind: "発売" | "予約" | "再販"; date: Date | null };

/**
 * コレクション名を「種別＋日付」に読み替える（純関数・selftest対象）。
 *  `20260807`   … 8月7日発売商品
 *  `pre20260724`… 7月24日予約商品
 *  `re20260805` … 8月5日再入荷商品
 */
export function parseChiikawaCollection(handle: string): ChiikawaCollection | null {
  const m = handle.match(/^(pre|re)?(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  const month = Number(m[3]);
  const day = Number(m[4]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const kind = m[1] === "pre" ? "予約" : m[1] === "re" ? "再販" : "発売";
  return { handle, kind, date: calendarDate(Number(m[2]), month, day) };
}

/**
 * 商品タイプをサイトのジャンル語彙に寄せる。
 *
 * `classifyGenre()` は「ぬいぐるみ」を**フィギュア**に倒すが、ここは全件が
 * キャラクターグッズなので、フィギュア/ソフビだけを分けて残りはキャラグッズに置く。
 * （語彙は itemFilter.ts の GENRE_ORDER が唯一の定義。無い名前を作らない）
 */
export function chiikawaGenre(productType: string, title: string): string {
  const t = `${productType} ${title}`;
  if (/ソフビ/.test(t)) return "ソフビ・アートトイ";
  if (/フィギュア/.test(t)) return "フィギュア";
  if (/カード|ブックマーク/.test(productType) && /トレーディング/.test(title)) return "キャラグッズ";
  return "キャラグッズ";
}

function toItem(
  p: ShopifyProduct,
  kind: "発売" | "予約" | "再販",
  date: Date | null
): ScrapedItem {
  const yen = Number(p.variants?.[0]?.price ?? 0);
  return {
    source: "chiikawa_market",
    sourceId: p.handle, // ちいかわマーケットの handle は JAN そのもの＝安定キー
    title: p.title.replace(/\s+/g, " ").trim(),
    genre: chiikawaGenre(p.product_type ?? "", p.title),
    subGenre: null,
    eventType: kind,
    eventDate: date,
    eventDateText: null,
    price: yen ? `${yen.toLocaleString()}円` : null,
    url: `${STORE}/products/${p.handle}`,
    imageUrl: p.images?.[0]?.src ?? null,
  };
}

export async function scrapeChiikawaMarket(): Promise<ScrapedItem[]> {
  const today = todayJst();
  const cutoff = today.getTime() - KEEP_DAYS_AFTER_RELEASE * 86_400_000;

  // トップに出ている日付別コレクションを列挙する（＝収集元が今見せている全部）。
  // 「トップ＝全部」と仮定せず、実際に並んでいるものを毎回読み直す。
  let handles: string[] = [];
  try {
    const top = await fetchHtml(`${STORE}/`);
    handles = [...new Set([...top.matchAll(DATED_COLLECTION_RE)].map((m) => m[1]))];
  } catch {
    handles = [];
  }

  const byId = new Map<string, ScrapedItem>();

  // ① 日付が確定しているコレクション（発売日／予約日／再入荷日）。
  for (const handle of handles) {
    const col = parseChiikawaCollection(handle);
    if (!col?.date) continue;
    // 発売日が過ぎたコレクションは、そのまま入れても表示側で落ちる（eventDate < today）。
    // 巡回の無駄を省くため、ここで先に切る。
    if (col.date.getTime() < cutoff) continue;
    let products: ShopifyProduct[];
    try {
      products = await fetchShopifyProducts(STORE, handle);
    } catch {
      continue;
    }
    await sleep(400);
    for (const p of products) {
      if (!byId.has(p.handle)) byId.set(p.handle, toItem(p, col.kind, col.date));
    }
  }

  // ② 新着・再入荷（日付なし＝「いま買える」速報）。
  //
  // **在庫があるものだけ**入れる。ちいかわは発売当日に売り切れるので、売り切れを
  // 「発売」として日付なしで並べると、押した先が品切れ＝行き止まりになる
  // （画面のラベルが約束することと実態を合わせる＝[[UIラベルは裏取り済みのみ約束]]）。
  for (const [handle, kind] of [
    ["newitems", "発売"],
    ["restock", "再販"],
  ] as const) {
    let products: ShopifyProduct[];
    try {
      products = await fetchShopifyProducts(STORE, handle);
    } catch {
      continue;
    }
    await sleep(400);
    for (const p of products) {
      if (byId.has(p.handle)) continue;
      if (!p.variants?.some((v) => v.available)) continue;
      byId.set(p.handle, toItem(p, kind, null));
    }
  }

  return [...byId.values()];
}
