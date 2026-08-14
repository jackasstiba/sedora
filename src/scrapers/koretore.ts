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
  // 「rare」枠の prize-box は id 属性を持たない（2026-08-14 に収集元が新設。23箱が
  // sourceId 空でURLが一覧ページ止まりになり、旧行と重複した）。一覧テーブルの
  // アンカーは全箱ぶん健在なので、商品名→id の対応表を作りタイトルで復元する。
  const normName = (s: string) => s.replace(/\s+/g, "").normalize("NFKC").toLowerCase();
  const idByName = new Map<string, string>();
  $("table.glance-table td.glance-name-cell > a[href^='#prize-b-']").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const id = href.replace("#", "");
    const spans = $(el).find("span");
    const name = spans.first().text().trim();
    const text = spans.last().text().trim();
    if (id && text) dateById.set(id, text);
    if (id && name) idByName.set(normName(name), id);
  });

  $("div.prize-box").each((_, boxEl) => {
    const box = $(boxEl);
    const title = box.find("> div.prize-title").first().text().trim();
    if (!title) return;
    const id = box.attr("id") || idByName.get(normName(title)) || "";

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
      // id が復元できない箱は素の一覧URLにする（「#」だけ残すと空フラグメントの
      // 同一URLが量産され、audit の同一リンク先検査に引っかかる）
      url: id ? `${LIST_URL}#${id}` : LIST_URL,
      imageUrl,
    });
  });

  return items;
}
