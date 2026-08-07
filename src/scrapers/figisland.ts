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

      // 商品ではなく「新作プライズ入荷予定表 未定情報」等の見出し／プレースホルダ行を除外。
      // 本物の商品は必ず詳細リンク(fiXXXX)か画像を持つので、両方欠けている行は捨てる
      // （薄いSEOページ・空カードの混入を防ぐ）。
      if (!idMatch && !imageUrl) return;
      // ※ 上の条件だけでは足りなかった。この見出し行は**画像を持っている**ため素通りし、
      //   DBから消しても次のスクレイプで新しいIDで復活していた（実測 #1 → #34535）。
      //   ページ自身の見出し語（入荷予定表）は商品名には現れない（全2566件中この行だけ）ので、
      //   個別ページを持たない＋見出し語を含む、の両方を満たす行を落とす。
      if (!idMatch && /入荷予定表/.test(title)) return;

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
