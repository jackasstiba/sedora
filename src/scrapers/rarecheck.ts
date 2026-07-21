import * as cheerio from "cheerio";
import { ScrapedItem } from "./types";
import { classifyGenre, extractDateAndEventFromText, fetchHtml, sleep } from "./util";

const BASE_URL = "https://rarecheck.one-cc.com/b/";
const MAX_PAGES = 3;

export async function scrapeRarecheck(): Promise<ScrapedItem[]> {
  const items: ScrapedItem[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = page === 1 ? BASE_URL : `${BASE_URL}?paged=${page}`;
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);
    const articles = $("#content[role='main'] > article.post");
    if (articles.length === 0) break;

    articles.each((_, articleEl) => {
      const article = $(articleEl);
      const titleLink = article.find("header.entry-header h1.entry-title a").first();
      const title = titleLink.text().trim();
      const href = titleLink.attr("href") ?? "";
      if (!title || !href) return;

      const category = article.find("footer.entry-meta a[rel='category']").first().text().trim();
      const postedAt = article.find("footer.entry-meta time.entry-date").first().attr("datetime") ?? null;

      const { date, eventType, dateText } = extractDateAndEventFromText(title);

      const idMatch = href.match(/p=(\d+)/);
      const sourceId = idMatch ? idMatch[1] : href;

      items.push({
        source: "rarecheck",
        sourceId,
        title,
        genre: classifyGenre(`${category} ${title}`),
        subGenre: category || null,
        eventType: eventType ?? "情報",
        eventDate: date,
        eventDateText: dateText ?? (postedAt ? `投稿日: ${postedAt.slice(0, 10)}` : null),
        price: null,
        url: href,
        imageUrl: null,
      });
    });

    await sleep(500);
  }

  return items;
}
