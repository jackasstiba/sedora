import * as cheerio from "cheerio";
import { ScrapedItem } from "./types";
import { fetchHtml, parseSlashMonthDay, sleep } from "./util";

const BASE = "https://snkrdunk.com/calendars";
const MONTHS_AHEAD = 2; // 今月＋2ヶ月分

// snkrdunkのカレンダーには「実際の発売エントリ」と「編集記事（◯選/ランキング/コラム）」が混在する。
// 発売エントリは必ずタイトル末尾が「｜抽選/販売/定価情報」の構造化フォーマットで、日付・定価も正確。
// 編集記事（「…10選！」「TOP50！」「…をチェック！」等）はこの接尾辞を持たず、
// 価格も記事内の一商品を拾うだけで無意味、日付もカレンダー上の任意日（今日など）になり
// “今日発売”の誤情報になる。→ 発売エントリのみ採用する。
export const SNKRDUNK_RELEASE_TITLE = /抽選\s*[／/]\s*販売\s*[／/]\s*定価情報/;

function monthKeys(): { key: string; year: number; month: number }[] {
  const out: { key: string; year: number; month: number }[] = [];
  const now = new Date();
  for (let i = 0; i <= MONTHS_AHEAD; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    out.push({ key: `${year}-${String(month).padStart(2, "0")}`, year, month });
  }
  return out;
}

export async function scrapeSnkrdunk(): Promise<ScrapedItem[]> {
  const items: ScrapedItem[] = [];

  for (const { key, year, month } of monthKeys()) {
    let html: string;
    try {
      html = await fetchHtml(`${BASE}/${key}/`);
    } catch {
      continue; // 未来すぎる月はページが無いことがある
    }
    const $ = cheerio.load(html);

    $("div.article-list-wrapper.calendar article.article-list").each((_, el) => {
      const article = $(el);
      const link = article.find("h3.article-title a").first();
      const href = link.attr("href") ?? "";
      const title = link.text().trim();
      if (!title || !href) return;
      // 編集記事（◯選/ランキング/コラム）を除外。発売エントリのみ採用。
      if (!SNKRDUNK_RELEASE_TITLE.test(title)) return;

      const dateText = article.find("div.date").first().text().trim();
      const eventDate = parseSlashMonthDay(dateText, year, month);

      const priceText = article
        .find("p.price")
        .first()
        .text()
        .replace(/\s+/g, "")
        .replace(/^価格：/, "");

      const imageUrl =
        article.find("div.article-img img").first().attr("data-src") ??
        article.find("div.article-img img").first().attr("src") ??
        null;

      const idMatch = href.match(/\/articles\/(\d+)/);
      const sourceId = idMatch ? idMatch[1] : href;
      const absoluteUrl = href.startsWith("http") ? href : `https://snkrdunk.com${href}`;

      items.push({
        source: "snkrdunk",
        sourceId,
        title,
        genre: "スニーカー",
        subGenre: null,
        eventType: "発売",
        eventDate,
        eventDateText: dateText || null,
        price: priceText || null,
        url: absoluteUrl,
        imageUrl,
      });
    });

    await sleep(600);
  }

  return items;
}
