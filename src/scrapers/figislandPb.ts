import * as cheerio from "cheerio";
import { ScrapeContext, ScrapedItem } from "./types";
import { classifyGenre, fetchHtml, parseJapaneseYearMonth, sleep } from "./util";

const LIST_URL = "https://figisland.net/p-bandai-schedule/";
// 1回のバッチで新規に詳細取得する上限（配信元への負荷を抑えるため）。
// 初回は複数回実行することで全件が埋まる。
const MAX_DETAIL_PER_RUN = 120;

type Entry = { sourceId: string; title: string; url: string; imageUrl: string | null };

function collectEntries(html: string): Entry[] {
  const $ = cheerio.load(html);
  const entries: Entry[] = [];
  const seen = new Set<string>();

  $("div.entry-content.cf[itemprop='mainEntityOfPage'] h4").each((_, h4El) => {
    const h4 = $(h4El);
    const title = h4.text().trim();
    if (!title) return;

    // 直前の <p><a href="/gs..._s/"><img></a></p>
    const prevP = h4.prev("p");
    const link = prevP.find("a[href*='/gs']").first();
    const href = link.attr("href") ?? "";
    const idMatch = href.match(/\/gs(\d+)_s\//);
    if (!idMatch) return;
    const sourceId = `gs${idMatch[1]}`;
    if (seen.has(sourceId)) return;
    seen.add(sourceId);

    const imageUrl = prevP.find("img").first().attr("src") ?? null;
    entries.push({ sourceId, title, url: href, imageUrl });
  });

  return entries;
}

function parseDetail(html: string): { eventType: string; eventDate: Date | null; eventDateText: string | null; price: string | null } {
  const $ = cheerio.load(html);
  const block = $("blockquote").first();
  const statusText = block.find("h3").first().text().trim();
  const priceRaw = block.find("h5").first().text().trim();

  const price = priceRaw ? priceRaw.replace(/^価格\s*/, "").trim() : null;
  const eventDate = parseJapaneseYearMonth(statusText);

  let eventType = "予約";
  if (/予約終了|受付終了|販売終了/.test(statusText)) eventType = "予約終了";
  else if (/予約開始/.test(statusText)) eventType = "予約開始";
  else if (/予約受付中|予約受付/.test(statusText)) eventType = "予約受付中";
  else if (/発売中/.test(statusText)) eventType = "発売中";

  return { eventType, eventDate, eventDateText: statusText || null, price };
}

export async function scrapeFigislandPb(ctx: ScrapeContext): Promise<ScrapedItem[]> {
  const listHtml = await fetchHtml(LIST_URL);
  const entries = collectEntries(listHtml);
  const items: ScrapedItem[] = [];

  let detailFetched = 0;
  for (const entry of entries) {
    // 既に価格まで取得済みのものは詳細を取りに行かない（既存レコードは維持）
    if (ctx.skipDetailIds.has(entry.sourceId)) continue;
    if (detailFetched >= MAX_DETAIL_PER_RUN) break;

    let detail = { eventType: "予約", eventDate: null as Date | null, eventDateText: null as string | null, price: null as string | null };
    try {
      const detailHtml = await fetchHtml(entry.url);
      detail = parseDetail(detailHtml);
    } catch {
      // 詳細取得に失敗しても一覧情報だけで登録する
    }
    detailFetched++;

    items.push({
      source: "figisland_pb",
      sourceId: entry.sourceId,
      title: entry.title,
      genre: classifyGenre(entry.title),
      subGenre: "プレバン",
      eventType: detail.eventType,
      eventDate: detail.eventDate,
      eventDateText: detail.eventDateText,
      price: detail.price,
      url: entry.url,
      imageUrl: entry.imageUrl,
    });

    await sleep(400);
  }

  return items;
}
