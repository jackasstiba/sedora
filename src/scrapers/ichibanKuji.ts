import { ScrapedItem } from "./types";
import { jstYearMonth, todayJst } from "../lib/date";
import { extractKujiFee, extractKujiPrizes, extractKujiStores, formatKujiHighlights } from "./ichibanKujiEnrich";
import { fetchHtml, monthPlanDate, parseJapaneseFullDate, parseJapaneseYearMonth, sleep } from "./util";

// 「2026年09月下旬発売予定」のような月精度は monthPlanDate の規約で月初を持たせる
// （当月なら null）。日は作らない＝表示は「2026年9月」のまま（date_fabricated_precision の約束）。
function kujiDate(dateText: string): Date | null {
  const full = parseJapaneseFullDate(dateText);
  if (full) return full;
  const ym = parseJapaneseYearMonth(dateText);
  return ym ? monthPlanDate(ym.getUTCFullYear(), ym.getUTCMonth() + 1, todayJst()) : null;
}

// 一番くじ倶楽部（BANDAI SPIRITS公式）のラインナップ。フィギュア景品・ラストワン賞は
// せどり/転売の二次相場が高い定番ジャンル。各商品に店頭/オンラインの発売日が入る。
// /products は「当月発売」しか出さないため、当月＋先2ヶ月＋発売予定(plan)を巡回して
// 先の予定まで取りこぼさない（せどらーが最も欲しいのは先の発売予定）。
const BASE = "https://1kuji.com/products";

// 各商品は <li><a href="/products/SLUG"> ... <p class="date">DATE</p> ... <p class="itemName">NAME</p> </a></li>
const ITEM_RE = /<a href="\/products\/([^"]+)">([\s\S]*?)<\/a>/g;

/** 月別巡回は**固定の月数ではなく「空の月が2つ続くまで」**進める（上限12ヶ月）。
 *  2026-08-15 実測: 固定「先2ヶ月」では 11月15・12月13・1月3件（ガンダムUC SAGA/
 *  ストファイ/CCさくら等）が窓の外に取り残されていた（本人が収集元で発見）。
 *  固定値はいつか収集元の告知範囲に追い越される＝窓ではなく終端を見る。 */
const MAX_MONTHS = 12;
const STOP_AFTER_EMPTY = 2;

function monthUrl(offset: number): string {
  // 月は必ず日本時間で決める。ローカル時刻で作ると、UTCの箱で回した場合に
  // 毎月1日の JST 00:00〜08:59 だけ前月のページを取りに行き、その月の新商品を丸ごと落とす。
  const { year, month } = jstYearMonth(offset);
  return `${BASE}?sale_month=${month}&sale_year=${year}`;
}

export async function scrapeIchibanKuji(): Promise<ScrapedItem[]> {
  const byId = new Map<string, ScrapedItem>();

  /** 一覧HTMLから商品を byId へ取り込み、見つけた商品カード数を返す。 */
  const collect = (html: string): number => {
    let found = 0;
    for (const m of html.matchAll(ITEM_RE)) {
      const slug = m[1];
      const inner = m[2];

      const name = inner.match(/class="itemName">([^<]+)</)?.[1]?.trim();
      if (!name) continue; // 商品カード以外の /products/ リンク（カテゴリ等）を除外
      found++;
      if (byId.has(slug)) continue;

      const image = inner.match(/src="(https:\/\/assets\.1kuji\.com\/[^"]+)"/)?.[1] ?? null;
      // 店頭販売の発売日が先に来る。最初の .date を発売日として使う。
      const dateText = inner.match(/class="date">([^<]+)</)?.[1]?.trim() ?? null;

      byId.set(slug, {
        source: "ichiban_kuji",
        sourceId: slug,
        title: name,
        genre: "一番くじ",
        subGenre: null,
        eventType: "発売",
        eventDate: dateText ? kujiDate(dateText) : null,
        eventDateText: dateText,
        price: null,
        url: `https://1kuji.com/products/${slug}`,
        imageUrl: image,
      });
    }
    return found;
  };

  let emptyStreak = 0;
  for (let i = 0; i < MAX_MONTHS && emptyStreak < STOP_AFTER_EMPTY; i++) {
    const html = await fetchHtml(monthUrl(i));
    await sleep(400);
    emptyStreak = collect(html) > 0 ? 0 : emptyStreak + 1;
  }
  collect(await fetchHtml(`${BASE}?sale_year=plan`)); // 発売予定（月未定）
  await sleep(400);

  const items = [...byId.values()];

  // 一覧では商品名止まりで“何が当たるか”に届かない。各商品の詳細ページを開いて
  // 各等賞一覧（A賞〜ラストワン賞＝二次相場の核）を抽出し highlights に載せる。
  // 一番くじは必ず抽選(くじ)で当たる形式なので hasLottery=true を立て、抽選タブでも拾う。
  // レート制限つき・失敗時はその商品だけ深掘りを諦めて一覧情報は活かす（壊さない）。
  for (const item of items) {
    try {
      const html = await fetchHtml(item.url);
      // 採算計算の前提＝1回いくら／どこで引けるか。読めた時だけ入れる（推測はしない）。
      item.price = extractKujiFee(html);
      item.salesChannel = extractKujiStores(html);
      const prizes = extractKujiPrizes(html);
      if (prizes.length) {
        item.highlights = formatKujiHighlights(prizes);
        item.hasLottery = true;
        // 各等賞を構造化（賞ラベル/賞品名/画像）してJSONで保持。相場(resale*)は
        // 発売済み品にだけ後付けするので、ここでは名前・画像まで（scrape:kuji:prices で相場付与）。
        item.prizes = JSON.stringify(prizes);
      }
    } catch {
      // 詳細取得に失敗しても一覧情報（商品名・発売日・画像）は活かす
    }
    await sleep(400);
  }

  return items;
}
