import * as cheerio from "cheerio";
import { ScrapeContext, ScrapedItem } from "./types";
import { classifyGenre, fetchHtml, parseJapaneseYearMonth, sleep } from "./util";

const LIST_URL = "https://figisland.net/p-bandai-schedule/";
// 1回のバッチで詳細取得する上限（配信元への負荷を抑えるため）。
// 「最後に取り直したのが古い順」に毎回この件数だけ回すので、250件なら1日（8時/20時の2回）で
// ほぼ一巡する。取りに行かなかった行は返さない＝既存レコードは無傷のまま残る。
const MAX_DETAIL_PER_RUN = 130;

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

type Detail = {
  eventType: string;
  eventDate: Date | null;
  eventDateText: string | null;
  price: string | null;
  officialUrl: string | null;
};

/**
 * 商品ページ本文にあるプレミアムバンダイの商品URL。
 *
 * これが**唯一の実際に買える場所**。以前は抽出しておらず、収集元非公開の方針で item.url も
 * 出さないため、プレバン品（/premium の 105件中 79件）は「駿河屋で見る（＝売り先）」と
 * 「楽天で探す（＝検索窓）」しか導線が無く、予約しに行けなかった。
 */
function findPbandaiUrl($: cheerio.CheerioAPI): string | null {
  const href = $("a[href*='p-bandai.jp/item/']").first().attr("href");
  if (!href) return null;
  // アフィリエイト/計測クエリは落として正規化（同一商品が別URLに見えないように）。
  return href.split("?")[0];
}

function parseDetail(html: string): Detail {
  const $ = cheerio.load(html);
  const block = $("blockquote").first();
  const statusText = block.find("h3").first().text().trim();
  const priceRaw = block.find("h5").first().text().trim();

  const price = priceRaw ? priceRaw.replace(/^価格\s*/, "").trim() : null;
  const eventDate = parseJapaneseYearMonth(statusText);

  // 「予約受付中」とは**書かない**。
  // 収集元の記事は予約開始時に書かれたきり更新されず、発送予定が2023年2月の商品まで
  // 「予約受付中」のまま残っている（実測: 全250件が「予約受付中」表記）。プレミアムバンダイ側は
  // Akamai のボット対策でサーバー側から受付状況を読めないため、こちらでは受付中と裏取りできない。
  // → 裏取り済みの事実（＝発送予定月）だけを約束し、受付状況は officialUrl で本人に確認させる。
  //   なお発送予定月を過ぎた行は表示層（date.ts の displayEventType）が「予約終了」に直す。
  let eventType = "予約";
  if (/予約終了|受付終了|販売終了/.test(statusText)) eventType = "予約終了";
  else if (/発売中/.test(statusText)) eventType = "発売中";

  return { eventType, eventDate, eventDateText: statusText || null, price, officialUrl: findPbandaiUrl($) };
}

export async function scrapeFigislandPb(ctx: ScrapeContext): Promise<ScrapedItem[]> {
  const listHtml = await fetchHtml(LIST_URL);
  const entries = collectEntries(listHtml);
  const items: ScrapedItem[] = [];

  // 「最後に詳細を取り直したのが古い順」に回す（未登録＝0＝最優先）。
  // 全件を毎回取ると収集元に負荷がかかるので、毎回 MAX_DETAIL_PER_RUN 件ずつ一巡させる。
  const order = [...entries].sort(
    (a, b) => (ctx.detailFetchedAt.get(a.sourceId) ?? 0) - (ctx.detailFetchedAt.get(b.sourceId) ?? 0)
  );

  let detailFetched = 0;
  for (const entry of order) {
    if (detailFetched >= MAX_DETAIL_PER_RUN) break;

    let detail: Detail;
    try {
      detail = parseDetail(await fetchHtml(entry.url));
    } catch {
      // 詳細取得の失敗は**一時的な失敗**であって「情報が消えた」ではない。ここで一覧情報だけの
      // 行（eventType/eventDate/price が空）を返すと、upsert が既存の正しい値を null で潰す。
      // 返さない＝この回は見送り、既存レコードをそのまま残す。
      await sleep(400);
      continue;
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
      // プレミアムバンダイの商品ページ＝実際に予約できる唯一の場所。
      officialUrl: detail.officialUrl,
    });

    await sleep(400);
  }

  return items;
}
