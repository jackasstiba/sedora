import * as cheerio from "cheerio";
import { ScrapedItem } from "./types";
import { fetchHtml, monthPlanDate, sleep } from "./util";
import { jstYearMonth, todayJst } from "../lib/date";

// ガシャポンオフィシャルサイトの発売スケジュール（bandai）＝**カプセルトイの一次情報**。
//
// なぜ足したか（2026-08-18 実測）: 「ガシャポン」3件・「カプセルトイ」16件は全部コラボ記事の
// 言及で、**一次情報は0件**だった。ただしカプセルトイは大半が300〜500円の量産品で、
// 全部載せると月150件×3ヶ月＝450件の低単価品でサイトが薄まる。
//
// 【載せる基準】転売の対象になるものだけに絞る:
//   ・「プレミアム」カテゴリ（1,000〜1,500円帯。いきもの大図鑑／アルティメットルミナス等）
//   ・商品名に「限定」（ガシャポンバンダイオフィシャルショップ限定など）
//   ・800円以上
// **量ではなく「転売向けか」で絞る**のがこのソースの設計意図なので、
// 件数が寂しいからと基準を緩めないこと。
//
// 【日付の精度】収集元は「8月第3週より順次」＝週精度で、しかも「地域や店舗によって異なる」と
// 但し書きがある。**日を作らない**（[[System/mistakes]] ミス15）ため eventDate は月初に置き、
// eventDateText を月精度（"2026年9月発売予定"）にして表示を「2026年9月」までに留める。
// 週の情報は精度を偽らないために捨てる。

const BASE = "https://gashapon.jp/schedule/";

/** 今月＋先2ヶ月。収集元は月ページを持っており、先の月ほど件数が少ない。 */
const MONTHS_AHEAD = 2;

/** 転売対象とみなす下限価格（円）。300〜500円の量産ガシャは対象外。 */
const RESALE_PRICE_FLOOR = 800;

export type GashaponCard = {
  janCode: string;
  name: string;
  category: string;
  yen: number | null;
  resale: boolean;
  imageUrl: string | null;
};

/** 月ページから商品カードを取り出す（純関数・selftest対象）。 */
export function parseGashaponSchedule(html: string): GashaponCard[] {
  const $ = cheerio.load(html);
  const cards: GashaponCard[] = [];
  $(".pg-data__schedule a.c-card__link").each((_, el) => {
    const a = $(el);
    const jan = (a.attr("href") ?? "").match(/jan_code=(\d+)/)?.[1];
    const name = a.find(".c-card__name").first().text().replace(/\s+/g, " ").trim();
    if (!jan || !name) return;
    const yenText = a.find(".c-card__price--main").first().text().replace(/[^\d]/g, "");
    cards.push({
      janCode: jan,
      name,
      category: a.find(".c-card__category").first().text().replace(/\s+/g, " ").trim(),
      yen: yenText ? Number(yenText) : null,
      resale: a.find(".c-card__resale").length > 0,
      imageUrl: a.find(".c-card__thumb img").first().attr("src") ?? null,
    });
  });
  return cards;
}

/** 転売の対象になりうるか（純関数・selftest対象）。上のコメントの3条件。 */
export function isResaleWorthyGashapon(card: GashaponCard): boolean {
  if (/プレミアム/.test(card.category)) return true;
  if (/限定/.test(card.name)) return true;
  return (card.yen ?? 0) >= RESALE_PRICE_FLOOR;
}

export function gashaponGenre(name: string): string {
  if (/^HG|ガンプラ|プラモ|1\/144/.test(name)) return "プラモ";
  if (/フィギュア|大図鑑|ルミナス|ソフビ/.test(name)) return "フィギュア";
  if (/ポケモン|ポケットモンスター/.test(name)) return "ポケモン";
  return "キャラグッズ";
}

export async function scrapeGashapon(): Promise<ScrapedItem[]> {
  const byId = new Map<string, ScrapedItem>();
  const today = todayJst();

  for (let offset = 0; offset <= MONTHS_AHEAD; offset++) {
    const { year, month } = jstYearMonth(offset);
    const url = offset === 0 ? BASE : `${BASE}?ym=${year}${String(month).padStart(2, "0")}`;
    let html: string;
    try {
      html = await fetchHtml(url);
    } catch {
      continue; // 先すぎる月はページが無いことがある
    }
    await sleep(500);

    for (const card of parseGashaponSchedule(html)) {
      if (!isResaleWorthyGashapon(card)) continue;
      if (byId.has(card.janCode)) continue;
      byId.set(card.janCode, {
        source: "gashapon",
        sourceId: card.janCode,
        title: card.name,
        genre: gashaponGenre(card.name),
        subGenre: card.category || null,
        eventType: card.resale ? "再販" : "発売",
        // 月精度。日は作らない（eventDateText がその旨を表す）。当月は月初が既に過去なので
        // null＝日付未定にして「いま買える」側で見せる（monthPlanDate のコメント参照）。
        eventDate: monthPlanDate(year, month, today),
        eventDateText: `${year}年${month}月発売予定`,
        price: card.yen ? `${card.yen.toLocaleString()}円` : null,
        url: `https://gashapon.jp/products/detail.php?jan_code=${card.janCode}`,
        imageUrl: card.imageUrl,
      });
    }
  }

  return [...byId.values()];
}
