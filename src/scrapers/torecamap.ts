import * as cheerio from "cheerio";
import { ScrapedItem } from "./types";
import { fetchHtml } from "./util";

const LIST_URL = "https://torecamap.co.jp/release-schedule";

function parseSlashDate(text: string): Date | null {
  const m = text.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  // 暦日は UTC 0時で作る（本番のUTC環境で1日ズレないように）
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
}

export async function scrapeTorecamap(): Promise<ScrapedItem[]> {
  const html = await fetchHtml(LIST_URL);
  const $ = cheerio.load(html);
  const items: ScrapedItem[] = [];

  $("div[class*='ReleaseScheduleDayGroup_release-schedule-day-group']").each((_, groupEl) => {
    const group = $(groupEl);
    const dateText = group.find("[class*='ReleaseScheduleDayGroup_date']").first().text().trim();
    const eventDate = parseSlashDate(dateText);

    group.find("[class*='ReleaseScheduleDayGroup_item']").each((_, itemEl) => {
      const el = $(itemEl);
      const link = el.find("a[class*='NewReleaseScheduleParts_release-schedule']").first();
      const href = link.attr("href") ?? "";
      const title = el.find("[class*='ProductInfo_name']").first().text().trim();
      if (!title) return;

      const genreTag = el.find("[class*='Tag_tag']").first().text().trim();
      const priceRows = el
        .find("[class*='ProductInfo_row']")
        .map((_, row) => $(row).text().trim())
        .get()
        .filter(Boolean);
      const imageUrlRaw = el.find("[class*='ProductInfo_image'], img").first().attr("src") ?? null;
      let imageUrl = imageUrlRaw;
      if (imageUrlRaw && imageUrlRaw.startsWith("/_next/image")) {
        const urlParam = new URLSearchParams(imageUrlRaw.split("?")[1] ?? "").get("url");
        if (urlParam) imageUrl = decodeURIComponent(urlParam);
      }

      items.push({
        source: "torecamap",
        sourceId: href || `${dateText}-${title}`,
        title,
        genre: "トレカ",
        subGenre: genreTag || null,
        eventType: "発売",
        eventDate,
        eventDateText: dateText || null,
        price: priceRows.join(" / ") || null,
        url: href || LIST_URL,
        imageUrl,
      });
    });
  });

  return items;
}
