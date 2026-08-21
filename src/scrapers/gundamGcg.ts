import { ScrapedItem } from "./types";
import { fetchHtml, monthPlanDate } from "./util";
import { calendarDate, todayJst } from "../lib/date";

// ガンダムカードゲーム（GUNDAM CARD GAME）公式サイト＝**新弾情報の一次情報**。
//
// なぜ足したか（2026-08-21）: 競合・カテゴリ調査（[[Projects/sedori_radar_hot_categories]]）で
// A級・1周年の新興タイトルとされながら、本番のガンダムカードは二次ソース経由の薄い扱いだった。
// 商品一覧（/jp/products/）は静的HTMLで、商品名・発売日・希望小売価格が swiper の
// カルーセル（mvBox）に入っている（実測: スタートデッキST11〜14=2026.9.26 等）。
//
// ⚠ ユニオンアリーナ・DBフュージョンワールドは**別マークアップ**（mvBox/category クラスなし）
// と実測済み（2026-08-21）＝この実装は流用できない。足すなら別スクレイパー。
//
// 【掲載方針】url は公式サイトの商品ページ（一次情報）＝直リンクしてよい。

const BASE = "https://www.gundam-gcg.com/jp/products/";

export type BandaiTcgBox = {
  category: string; // スタートデッキ / ブースターパック / …
  number: string | null; // ST14 等
  title: string; // Heavy Dominion 等
  dateText: string; // "2026.9.26"（一覧の生文言）
  price: string | null; // "1,650円（税込）"
  url: string; // 商品詳細（絶対URL）
  imageUrl: string | null;
};

/** 一覧HTMLから mvBox（商品カルーセル）を取り出す（純関数・selftest対象）。 */
export function parseGundamProducts(html: string, base = BASE): BandaiTcgBox[] {
  const out: BandaiTcgBox[] = [];
  const blocks = html.split(/<div class="mvBox">/).slice(1);
  for (const block of blocks) {
    const category = block.match(/<div class="category">([^<]*)<\/div>/)?.[1]?.trim() ?? "";
    const number = block.match(/<div class="number">\[?([^<\]]*)\]?<\/div>/)?.[1]?.trim() || null;
    const title = block.match(/<h\d class="title">([^<]*)<\/h\d>/)?.[1]?.trim() ?? "";
    const dateText = block.match(/<div class="date">([^<]*)<\/div>/)?.[1]?.trim() ?? "";
    const priceYen = block.match(/[￥¥]\s*([\d,]+)/)?.[1] ?? null;
    const href = block.match(/<a href="([^"]+)"[^>]*class="btn"/)?.[1] ?? null;
    const img = block.match(/<img src="([^"]+)"/)?.[1] ?? null;
    if (!title || !dateText) continue;
    out.push({
      category,
      number,
      title,
      dateText,
      price: priceYen ? `${priceYen}円（税込）` : null,
      url: href ? new URL(href, base).toString() : base,
      imageUrl: img ? new URL(img, base).toString() : null,
    });
  }
  return out;
}

/** "2026.9.26" → 暦日／"2026.9" のような月精度は monthPlanDate の規約に従う（純関数・selftest対象）。 */
export function parseGundamDate(dateText: string, today: Date): Date | null {
  const full = dateText.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  if (full) return calendarDate(Number(full[1]), Number(full[2]), Number(full[3]));
  const ym = dateText.match(/(\d{4})\.(\d{1,2})/);
  if (ym) return monthPlanDate(Number(ym[1]), Number(ym[2]), today);
  return null;
}

export async function scrapeGundamGcg(): Promise<ScrapedItem[]> {
  const html = await fetchHtml(BASE);
  const boxes = parseGundamProducts(html);
  // 0件は「新商品が無い」ではなくマークアップ変更とみなして赤くする
  // （カルーセルは常設。巡回失敗なら前回データが残り、3日で source_stale が知らせる）。
  if (boxes.length === 0) throw new Error("gundam_gcg: 商品カルーセルが0件（マークアップ変更を疑う）");

  const today = todayJst();
  const items: ScrapedItem[] = [];
  for (const b of boxes) {
    const date = parseGundamDate(b.dateText, today);
    // 発売済みは入れない（表示側でも落ちる）。日付が読めない行は日付未定として載せる。
    if (date && date.getTime() < today.getTime()) continue;
    items.push({
      source: "gundam_gcg",
      sourceId: (b.number ?? b.title).toLowerCase(),
      title: `ガンダムカードゲーム ${b.category} ${b.title}${b.number ? ` [${b.number}]` : ""}`.trim(),
      genre: "トレカ",
      subGenre: "ガンダムカードゲーム",
      eventType: "発売",
      eventDate: date,
      eventDateText: b.dateText || null,
      price: b.price,
      url: b.url,
      imageUrl: b.imageUrl,
    });
  }
  return items;
}
