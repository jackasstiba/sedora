import * as cheerio from "cheerio";
import { ScrapedItem } from "./types";
import { fetchHtml, parseYyyymmdd } from "./util";

const LIST_URL = "https://figisland.net/prizes-schedule/";

export async function scrapeFigisland(): Promise<ScrapedItem[]> {
  const html = await fetchHtml(LIST_URL);
  const $ = cheerio.load(html);
  const items: ScrapedItem[] = [];

  $("div.entry-content.cf[itemprop='mainEntityOfPage'] > div.yoteiall").each((_, groupEl) => {
    const group = $(groupEl);
    const heading = group.find("> h2[id]").first();
    const headingId = heading.attr("id") ?? "";
    const eventDate = parseYyyymmdd(headingId);
    const headingText = heading.text().trim();

    group.find("> div.yotei").each((_, itemEl) => {
      const el = $(itemEl);
      const title = el.find("> h4").first().text().trim();
      if (!title) return;

      const detailLink = el.find("a.btn.btn-red").first().attr("href") ?? "";
      const idMatch = detailLink.match(/\/fi(\d+)_s\//);
      const sourceId = idMatch ? `fi${idMatch[1]}` : detailLink || title;

      const imageUrl = el.find("p").first().find("img").first().attr("src") ?? null;

      items.push({
        source: "figisland",
        sourceId,
        title,
        genre: "フィギュア",
        subGenre: "プライズ",
        eventType: "登場予定",
        eventDate,
        eventDateText: headingText || null,
        price: null,
        url: detailLink || LIST_URL,
        imageUrl,
      });
    });
  });

  return items;
}
