import { ScrapedItem } from "./types";
import { fetchHtml, parseJapaneseFullDate, parseJapaneseYearMonth, monthPlanDate, sleep, type ShopifyProduct } from "./util";
import { crawlPages, lastIsOlderThan } from "./crawl";
import { isGenericImageUrl } from "./imagePick";
import { jstCalDate, todayJst } from "../lib/date";

// hololive production OFFICIAL SHOP（Shopify）＝**ホロライブグッズの一次情報**。
//
// なぜ足したか: ミス6（ホロライブ×極楽湯タオル＝収集元にあるのにサイトに無い）で露呈した
// 「本命カテゴリの一次情報ゼロ」の穴。受注生産・数量限定が多く、受注期間を逃すと二度と
// 買えない（＝サイトの訴求そのもの）。2026-07-28 の候補調査から挙がり続けて未実装だった。
//
// 取得方式（2026-08-21 実測）:
//  - 新着は店舗レベルの公開JSON `/products.json`（published_at 降順）で拾う。
//    ちいかわ型の「日付別コレクション」は**この店には無い**。
//  - 受注の締切は products.json に無く、**商品ページの `Pdt_shipping` 節にだけある**:
//      受注生産商品 … 「受注受付期間 : 2026年08月20日 20時00分 ～ 2026年09月24日 18時00分」
//      予約販売     … 期間なし・「発送予定日：2026年09月中旬までに発送」のみ
//    → タグが 受注生産商品/予約販売/販売開始前 の行だけ商品ページを開いて締切を取る。
//
// 【掲載方針】url は公式ショップの商品ページ（一次情報）＝直リンクしてよい。

const STORE = "https://shop.hololivepro.com";
/** 「直近◯日の新着」を載せる窓。取り込みと掲載で同じ物差しを使う（pokemon_goods の教訓）:
 *  この窓から外れた行は返さない → 日付なしの行は RECONCILE_UNDATED_SOURCES の突き合わせで消える。 */
export const HOLO_RECENT_DAYS = 30;
/** 商品ページを開く上限（収集元への負荷の保険。窓内の受注商品は実測で数十件） */
const MAX_DETAIL_PER_RUN = 90;

/** 受注・予約系のタグ（この行だけ商品ページを開く） */
export function isHoloPreorder(tags: string[]): boolean {
  return tags.some((t) => /受注生産|予約販売|販売開始前/.test(t));
}

export type HoloSchedule = {
  periodEnd: Date | null;
  periodRaw: string | null; // 「2026年08月20日 20時00分 ～ 2026年09月24日 18時00分」
  shipRaw: string | null; // 「2026年09月中旬までに発送」
  shipMonthDate: (today: Date) => Date | null;
};

/** 商品ページから受注受付期間・発送予定日を読む（純関数・selftest対象）。 */
export function parseHoloSchedule(html: string): HoloSchedule {
  const period = html.match(/受注受付期間<\/span>\s*[:：]\s*([^<]+?)\s*<\/p>/)?.[1]?.replace(/\s+/g, " ").trim() ?? null;
  let periodEnd: Date | null = null;
  if (period) {
    const parts = period.split(/[～〜]/);
    periodEnd = parts.length >= 2 ? parseJapaneseFullDate(parts[1]) : null;
  }
  const ship = html.match(/発送予定日<\/span>\s*[:：]?\s*([^<]{2,60})/)?.[1]?.replace(/\s+/g, " ").trim() ?? null;
  return {
    periodEnd,
    periodRaw: period,
    shipRaw: ship,
    shipMonthDate: (today) => {
      const ym = ship ? parseJapaneseYearMonth(ship) : null;
      return ym ? monthPlanDate(ym.getUTCFullYear(), ym.getUTCMonth() + 1, today) : null;
    },
  };
}

/**
 * 商品画像を選ぶ（純関数・selftest対象）。
 *
 * この店の images[0] は「holo_◯◯_banner_JP_◯◯.png」のような**告知バナー**であることが
 * 多く（実測: 250商品中136枚が banner 名）、保存側の汎用画像フィルタ（isGenericImageUrl）に
 * 落とされて画像なしになっていた。商品写真は配列の後ろにあるので、**汎用判定に落ちない
 * 最初の1枚**を選ぶ。全部バナーなら null（推測画像を付けない）。
 */
export function holoImage(images: { src: string }[] | undefined): string | null {
  for (const img of images ?? []) {
    if (img.src && !isGenericImageUrl(img.src)) return img.src;
  }
  return null;
}

/**
 * variant のタイトルに入っている販売単位を商品名に足す（純関数・selftest対象）。
 *
 * 実測（audit `price_unit_suspect`）: 商品名「ブースターパック「ボリュームヴォルテックス」」に
 * 5,280円が付き「単パックがBOX価格?」と鳴った。実体は variant 名が
 * 「…（BOX：12パック入り）」の**BOX売り**。販売単位は価格の意味そのものなので、
 * variant が BOX と言っているのに商品名が言っていない行は商品名に単位を足す。
 */
export function holoTitleWithUnit(title: string, variantTitle: string | undefined): string {
  if (!variantTitle || /BOX|ボックス/i.test(title)) return title;
  const m = variantTitle.match(/[（(](BOX[^（）()]*)[）)]/i);
  return m ? `${title}（${m[1]}）` : title;
}

/** タイトル → サイトのジャンル語彙（GENRE_ORDER が唯一の定義）。 */
export function holoGenre(title: string): string {
  if (/カードゲーム|ブースターパック|スターターデッキ|ホロカ/i.test(title)) return "トレカ";
  if (/figma|ねんどろいど|フィギュア|POP UP PARADE|スケール/i.test(title)) return "フィギュア";
  if (/ソフビ/.test(title)) return "ソフビ・アートトイ";
  return "キャラグッズ";
}

type HoloProduct = ShopifyProduct & { tags: string[] };

export async function scrapeHololiveShop(): Promise<ScrapedItem[]> {
  const today = todayJst();
  const cutoffMs = today.getTime() - HOLO_RECENT_DAYS * 86_400_000;

  // 店舗レベルの products.json は published_at 降順（実測）。窓の日付で足切りする。
  const products = await crawlPages<HoloProduct>({
    label: "hololive_shop",
    urlOf: (page) => `${STORE}/products.json?limit=250&page=${page}`,
    parse: (body) => {
      const data = JSON.parse(body) as { products?: HoloProduct[] };
      return data.products ?? [];
    },
    keyOf: (p) => p.handle,
    isPageOld: lastIsOlderThan((p) => Date.parse(p.published_at), cutoffMs),
    maxPages: 8,
    sleepMs: 300,
  });
  // 0件は「新商品が無い」ではなく取得の壊れ（API仕様の変化等）とみなして赤くする。
  if (products.length === 0) throw new Error("hololive_shop: products.json が0件（API仕様の変化を疑う）");

  const items: ScrapedItem[] = [];
  let detailFetched = 0;
  // ループ変数を `p` にしない: crawlLint はページ番号らしき変数（p を含む）のループ内 fetch を
  // 「自前のページ送り」と見なす。これは配列を回す詳細取得ループ＝対象外の形だと名前で示す。
  for (const product of products) {
    const publishedMs = Date.parse(product.published_at);
    if (!Number.isFinite(publishedMs) || publishedMs < cutoffMs) continue;
    const tags = Array.isArray(product.tags) ? product.tags : [];
    const title = holoTitleWithUnit(product.title.replace(/\s+/g, " ").trim(), product.variants?.[0]?.title);
    if (!title) continue;
    const yen = Number(product.variants?.[0]?.price ?? 0);
    const base = {
      source: "hololive_shop",
      sourceId: product.handle,
      title,
      genre: holoGenre(title),
      subGenre: "ホロライブ",
      price: yen ? `${yen.toLocaleString()}円` : null,
      url: `${STORE}/products/${product.handle}`,
      imageUrl: holoImage(product.images),
    };

    if (isHoloPreorder(tags)) {
      // 締切は商品ページにしかない。取得に失敗した行は**返さない**＝前回の正しい締切を
      // null で潰さない（figisland_pb と同じ判断）。
      if (detailFetched >= MAX_DETAIL_PER_RUN) continue;
      let sched: HoloSchedule;
      try {
        sched = parseHoloSchedule(await fetchHtml(base.url));
      } catch {
        await sleep(300);
        continue;
      }
      detailFetched++;
      await sleep(300);
      if (sched.periodEnd) {
        // 掲載範囲を決めるのは受付の**最後の締切**。文言も保存して突合できるようにする。
        items.push({
          ...base,
          eventType: "予約",
          eventDate: sched.periodEnd,
          eventDateText: `受注受付期間 ${sched.periodRaw}`,
        });
      } else {
        // 予約販売（締切なし）は発送予定月を予定日に（月初が過ぎていれば日付未定＝文言だけ）。
        items.push({
          ...base,
          eventType: "予約",
          eventDate: sched.shipMonthDate(today),
          eventDateText: sched.shipRaw,
        });
      }
      continue;
    }

    // 在庫販売の新着（日付なし＝「いま買える」）。売り切れは載せない
    // （押した先が品切れ＝行き止まりになる。[[UIラベルは裏取り済みのみ約束]]）。
    if (!product.variants?.some((v) => v.available)) continue;
    const appeared = jstCalDate(publishedMs);
    items.push({
      ...base,
      eventType: "発売",
      eventDate: null,
      eventDateText: `登場 ${appeared.getUTCMonth() + 1}/${appeared.getUTCDate()}`,
    });
  }
  return items;
}
