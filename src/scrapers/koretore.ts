import * as cheerio from "cheerio";
import { ScrapedItem } from "./types";
import { fetchHtml, parseJapaneseFullDate } from "./util";

const LIST_URL = "https://kore-tore.com/prize-latest-figure/";

export async function scrapeKoretore(): Promise<ScrapedItem[]> {
  const html = await fetchHtml(LIST_URL);
  const $ = cheerio.load(html);
  const items: ScrapedItem[] = [];

  // Build id -> precise date map from the glance table ("登場日：2026年8月6日(木)")
  const dateById = new Map<string, string>();
  $("table.glance-table td.glance-name-cell > a[href^='#prize-b-']").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const id = href.replace("#", "");
    const text = $(el).find("span").last().text().trim();
    if (id && text) dateById.set(id, text);
  });

  $("div.prize-box").each((_, boxEl) => {
    const box = $(boxEl);
    const id = box.attr("id") ?? "";
    const title = box.find("> div.prize-title").first().text().trim();
    if (!title) return;

    const roughPeriod = box
      .find("ul.spec-list > li")
      .filter((_, li) => $(li).text().includes("登場時期"))
      .first()
      .text()
      .replace(/^登場時期[：:]/, "")
      .trim();

    const preciseDateText = dateById.get(id) ?? "";
    const eventDate = parseJapaneseFullDate(preciseDateText) ?? null;

    const imageUrl =
      box.find("figure.card-image-wrapper img").first().attr("data-src") ??
      box.find("figure.card-image-wrapper img").first().attr("src") ??
      null;

    items.push({
      source: "koretore",
      sourceId: id || title,
      title,
      genre: "フィギュア",
      subGenre: "プライズ",
      eventType: "登場予定",
      eventDate,
      eventDateText: preciseDateText || roughPeriod || null,
      price: null,
      url: `${LIST_URL}#${id}`,
      imageUrl,
    });
  });

  return items;
}
