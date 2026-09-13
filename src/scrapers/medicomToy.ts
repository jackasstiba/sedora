import { ScrapedItem } from "./types";
import { fetchShopifyProducts, monthPlanDate, resolveMonthDay, sleep, type ShopifyProduct } from "./util";
import { calendarDate, todayJst } from "../lib/date";
import { crawlPages } from "./crawl";
import { EN_ONLY_SCOPE } from "../lib/scope";
import { CATALOG_EVENT_TYPE } from "./shopifyCharaStore";

// メディコム・トイ公式（BE@RBRICK / MAFEX / ソフビ）＝**受注開始（＝予約できる）の一次情報**。
//
// なぜ足したか（2026-08-18 実測）: 本番3512件に「BE@RBRICK」「ベアブリック」「メディコム」が
// **3語とも0件**。ジャンル「ソフビ・アートトイ」に至っては全体で3件しかなく、実質空だった。
// ベアブリックは1体1〜3万円台の受注品が二次で数倍になる定番なので、穴としては相当大きい。
//
// 取得方式（2026-09-12 作り直し）: 企業サイト `www.medicomtoy.co.jp/top/` の告知一覧と
// `/list/<id>.html` の商品ページは **2026-09 に廃止され 404** になった（実測: 9/4 から巡回が
// 落ち続け、旧URLは `medicomtoy.co.jp/list/…` へ 301 した先も無い）。企業サイト自体が
// Shopify に移り、商品は公式ストア `store.medicomtoy.co.jp` に一本化されたので、
// **ストアの公開JSON（/collections/<handle>/products.json）** から取る。
//
// 発売予定はタイトル末尾の `《2026年9月発売予定》` `《2027年2月発送予定 受注期間は9月30日まで》`
// に入っている（実測: new-release 32件は全件この形）。本文（body_html）には無い。
//
// 【掲載基準】旧実装と同じ＝**発売/発送の予定が読めない商品は載せない**（受注開始の告知で
// あることの裏付けがタイトルの《》しか無い）。受注期間の締切があれば締切を eventDate にする
// （hololive_shop と同じ型＝「逃すと買えない」日）。無ければ発売月の月精度。
//
// 【掲載方針】url は公式ストアの商品ページ（一次情報）＝直リンクしてよい。

const STORE = "https://store.medicomtoy.co.jp";

/**
 * 読むコレクション。`new-release`（当月の受注開始）だけだと、翌月に告知が入れ替わった瞬間に
 * まだ受注中の前月分が消える。`coming-soon`（発売予定の全体）と `new-items`（新着）を重ねて、
 * 《予定》付きの商品を取りこぼさない。重複は product id で畳む。
 */
const COLLECTIONS = ["new-release", "coming-soon", "new-items"];

/** EN 専用カタログに使う商品ラインのコレクション（店のナビに並ぶ現行ライン。実測 2026-09-13 の件数）。 */
const CATALOG_COLLECTIONS = [
  "bearbrick", // 679
  "ultra-detail-figure", // 419
  "medicomtoy-life-entertainment", // 276
  "new-items", // 198
  "mafex", // 134
  "others", // 100
  "sofvi", // 49
  "vinyl-collectible-dolls", // 37
  "real-action-heroes", // 27
  "fabrick", // 22
  "skate-art-deck", // 9
  "kubrick", // 3
];

export type MedicomPlan = {
  name: string; // 《…》を落とした商品名
  planText: string; // 《》の中身そのまま（「2027年2月発送予定 受注期間は9月30日まで」）
  year: number;
  month: number;
  day: number | null; // 日まで書いてある予定だけ入る（無ければ月精度）
  deadline: Date | null; // 「受注期間は9月30日まで」があればその日
  deadlineText: string | null; // 「受注期間は9月30日まで」
};

/**
 * 商品タイトルから商品名と発売予定・受注締切を読む（純関数・selftest対象）。
 * 予定（YYYY年M月）が読めなければ null＝載せない。
 *
 * 実測した形:
 *   「BE@RBRICK MOFF GIDEON(TM) 400％《2026年9月発売予定》」
 *   「VAG SERIES SP 仮面ライダー × おおかみくん《2026年9月19日発売予定》」
 *   「SOFVI DARTH VADER《2027年2月発送予定 受注期間は9月30日まで》」
 *   「…《2027年2月発送予定 受注期間は8月22日(土)23:59まで》」
 *   「…《2026年10月発売・発送予定 受注期間は2026年7月10日まで》」
 */
export function parseMedicomTitle(title: string, today: Date): MedicomPlan | null {
  const t = title.replace(/\s+/g, " ").trim();
  const m = t.match(/《([^》]*)》\s*$/);
  if (!m || m.index === undefined) return null;
  const planText = m[1].trim();
  const name = t.slice(0, m.index).trim();
  if (!name) return null;

  const ym = planText.match(/(\d{4})年\s*(\d{1,2})月/);
  if (!ym) return null;
  const year = Number(ym[1]);
  const month = Number(ym[2]);
  if (month < 1 || month > 12) return null;
  // 日まで書いてある予定（「2026年9月19日発売予定」）。**日を読まずに月初を入れると
  // カードに 9/1 という実在しない発売日が出る**（[[System/mistakes]] ミス15）ので分ける。
  const dayMatch = planText.match(/^\d{4}年\s*\d{1,2}月\s*(\d{1,2})\s*日/);
  const day = dayMatch ? Number(dayMatch[1]) : null;

  let deadline: Date | null = null;
  let deadlineText: string | null = null;
  const dl = planText.match(/受注期間は\s*(?:(\d{4})年)?\s*(\d{1,2})月\s*(\d{1,2})日[^ま]*まで/);
  if (dl) {
    const dm = Number(dl[2]);
    const dd = Number(dl[3]);
    if (dm >= 1 && dm <= 12 && dd >= 1 && dd <= 31) {
      deadline = dl[1] ? calendarDate(Number(dl[1]), dm, dd) : resolveMonthDay(dm, dd, today);
      deadlineText = dl[0].replace(/\s+/g, " ").trim();
    }
  }
  return { name, planText, year, month, day, deadline, deadlineText };
}

export function medicomGenre(name: string, productType = ""): string {
  const t = `${productType} ${name}`;
  if (/BE@RBRICK|ベアブリック|KUBRICK/i.test(t)) return "ソフビ・アートトイ";
  if (/ソフビ|SOFVI|VINYL|VAG/i.test(t)) return "ソフビ・アートトイ";
  if (/フィギュア|figure|RAH|MAFEX|REAL ACTION HEROES/i.test(t)) return "フィギュア";
  return "ソフビ・アートトイ";
}

/** Shopify の商品1件を掲載行にする（純関数・selftest対象）。載せない商品は null。 */
export function medicomItemFromProduct(p: ShopifyProduct, today: Date): ScrapedItem | null {
  const plan = parseMedicomTitle(p.title, today);
  if (!plan) return null;

  // 締切がある受注＝締切を「逃すと買えない日」として出す。締切を過ぎた受注は載せ続けない。
  // 締切が無い＝発売予定の月まで残す（日精度なら当日まで、月精度ならその月いっぱい。
  // 月精度の行を月初で切ると、まだ受注中の「今月発売」が初日に消える）。
  let eventDate: Date | null;
  let eventDateText: string | null;
  let expiry: number;
  if (plan.deadline) {
    eventDate = plan.deadline;
    eventDateText = plan.deadlineText;
    expiry = plan.deadline.getTime();
  } else if (plan.day) {
    eventDate = calendarDate(plan.year, plan.month, plan.day);
    eventDateText = plan.planText;
    expiry = eventDate.getTime();
  } else {
    // 当月なら null＝日付未定にして、月初という過去の日で消えないようにする（monthPlanDate）。
    eventDate = monthPlanDate(plan.year, plan.month, today);
    eventDateText = plan.planText;
    expiry = calendarDate(plan.year, plan.month + 1, 1).getTime() - 1;
  }
  if (expiry < today.getTime()) return null;

  // ストアの JSON 価格は**税抜**（実測: JSON 10909 ↔ 商品ページ「¥10,909 (税込¥12,000)」）。
  // サイトの価格欄は他ソースと同じく税込で揃える（×1.1 を四捨五入＝ページの表示と一致）。
  const v0 = p.variants?.[0];
  const raw = v0?.price ? Number(v0.price) : NaN;
  const price = v0?.taxable === false ? raw : Math.round(raw * 1.1);
  return {
    source: "medicom_toy",
    sourceId: String(p.id),
    title: plan.name,
    genre: medicomGenre(plan.name, p.product_type),
    subGenre: null,
    // 収集元が「受注期間」「発売予定」と言っている＝いま予約できる。
    eventType: "予約",
    eventDate,
    eventDateText,
    price: Number.isFinite(price) && price > 0 ? `${price.toLocaleString()}円` : null,
    url: `${STORE}/products/${p.handle}`,
    imageUrl: p.images?.[0]?.src ?? null,
    // 締切で eventDate を使った行は、発送予定を補足として残す（日付欄からは消えるので）。
    highlights: plan.deadline ? plan.planText.replace(plan.deadlineText ?? "", "").trim() || null : null,
    storeListedAt: p.published_at ? new Date(p.published_at) : null,
  };
}

/**
 * EN専用カタログ行（[[Projects/sedori_radar_en]] Phase 3b'・2026-09-13 にこの店へ横展開）＝
 * 予定コレクションには無いが**店のカタログ（`collections/all`）に今も在庫がある**商品。
 * 日本の読者には新着でないので日本語面には出さないが、海外の読者には BE@RBRICK / MAFEX の
 * 現行在庫そのものが価値（chara 3店と同じ設計＝ shopifyCharaStore.ts の toCatalogItem）。
 * 日付は持たせない。約束するのは「この日、店の一覧に在庫ありで並んでいた」まで。
 */
export function medicomCatalogItem(p: ShopifyProduct): ScrapedItem | null {
  if (!p.variants?.some((v) => v.available)) return null; // 売り切れは載せない（押した先が行き止まり）
  // 《…予定》付き＝受注/予約中の商品。予定コレクションで拾えなかった行（別IDの同名商品等）を
  // 「Out now / still listed」の顔で出さない（実測 2026-09-13: SFS グレート・ムタ（受注中）がカタログに出た）。
  if (/《[^》]*》/.test(p.title)) return null;
  const name = p.title.replace(/\s+/g, " ").trim();
  if (!name) return null;
  const v0 = p.variants[0];
  const raw = v0?.price ? Number(v0.price) : NaN;
  const price = v0?.taxable === false ? raw : Math.round(raw * 1.1);
  const listed = p.published_at ? Date.parse(p.published_at) : NaN;
  return {
    source: "medicom_toy",
    sourceId: String(p.id),
    title: name,
    genre: medicomGenre(name, p.product_type),
    subGenre: null,
    eventType: CATALOG_EVENT_TYPE,
    eventDate: null,
    eventDateText: null,
    price: Number.isFinite(price) && price > 0 ? `${price.toLocaleString()}円` : null,
    url: `${STORE}/products/${p.handle}`,
    imageUrl: p.images?.[0]?.src ?? null,
    scope: EN_ONLY_SCOPE,
    storeListedAt: Number.isFinite(listed) ? new Date(listed) : null,
  };
}

export async function scrapeMedicomToy(): Promise<ScrapedItem[]> {
  const today = todayJst();
  const byId = new Map<string, ScrapedItem>();
  let fetched = 0;
  for (const c of COLLECTIONS) {
    const products = await fetchShopifyProducts(STORE, c);
    fetched += products.length;
    for (const p of products) {
      const item = medicomItemFromProduct(p, today);
      if (item && !byId.has(item.sourceId)) byId.set(item.sourceId, item);
    }
    await sleep(300);
  }
  // 3コレクション合計が0件＝入口が変わった（コレクションの handle が消えた等）。
  // 静かに0件を返すと健全性チェックが「静かな日」と区別できないので、エラーで落とす。
  if (fetched === 0) throw new Error("ストアのコレクションが全て0件（入口が変わった疑い）");

  // 店の現行ライン（商品ラインごとのコレクション）。`collections/all` と店全体の /products.json は
  // Shopify の自動コレクション＝**アーカイブ込みの全商品（1.5万件超）**で、現行在庫の一覧にならない
  // （実測 2026-09-13: 60ページ辿っても終わらなかった）。ラインの一覧を並べる方が「店がいま売っている物」
  // に近い。予定コレクションで拾った行はそのまま、それ以外の在庫ありを EN 専用カタログとして足す。
  let catalogFetched = 0;
  for (const c of CATALOG_COLLECTIONS) {
    const products = await crawlPages<ShopifyProduct>({
      label: `${STORE}/${c}`,
      urlOf: (page) => `${STORE}/collections/${c}/products.json?limit=250&page=${page}`,
      parse: (body) => (JSON.parse(body) as { products?: ShopifyProduct[] }).products ?? [],
      keyOf: (p) => String(p.id),
      maxPages: 6, // 最大は bearbrick 679件＝3ページ（実測）。安全弁
      sleepMs: 300,
    });
    catalogFetched += products.length;
    for (const p of products) {
      if (byId.has(String(p.id))) continue;
      const item = medicomCatalogItem(p);
      if (item) byId.set(item.sourceId, item);
    }
  }
  // 0件は例外（空配列を返すと突き合わせ削除がカタログ行を全部消す）。
  if (catalogFetched === 0) throw new Error(`${STORE}: ラインのコレクションが全て0件（カタログ取得の失敗を疑う）`);
  return [...byId.values()];
}
