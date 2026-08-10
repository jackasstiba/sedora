import { ScrapedItem } from "./types";
import { extractKujiFee, extractKujiPrizes, extractKujiStores, formatKujiHighlights } from "./ichibanKujiEnrich";
import { fetchHtml, parseJapaneseFullDate, sleep } from "./util";

// 一番くじ倶楽部（BANDAI SPIRITS公式）のラインナップ。フィギュア景品・ラストワン賞は
// せどり/転売の二次相場が高い定番ジャンル。各商品に店頭/オンラインの発売日が入る。
// /products は「当月発売」しか出さないため、当月＋先2ヶ月＋発売予定(plan)を巡回して
// 先の予定まで取りこぼさない（せどらーが最も欲しいのは先の発売予定）。
const BASE = "https://1kuji.com/products";

// 各商品は <li><a href="/products/SLUG"> ... <p class="date">DATE</p> ... <p class="itemName">NAME</p> </a></li>
const ITEM_RE = /<a href="\/products\/([^"]+)">([\s\S]*?)<\/a>/g;

/** 当月・翌月・翌々月の {月,年} と、発売予定(plan) の巡回URLを作る */
function listingUrls(): string[] {
  const urls: string[] = [];
  const now = new Date();
  for (let i = 0; i < 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    urls.push(`${BASE}?sale_month=${d.getMonth() + 1}&sale_year=${d.getFullYear()}`);
  }
  urls.push(`${BASE}?sale_year=plan`); // 発売予定（月未定）
  return urls;
}

export async function scrapeIchibanKuji(): Promise<ScrapedItem[]> {
  const byId = new Map<string, ScrapedItem>();

  for (const url of listingUrls()) {
    const html = await fetchHtml(url);
    for (const m of html.matchAll(ITEM_RE)) {
      const slug = m[1];
      const inner = m[2];

      const name = inner.match(/class="itemName">([^<]+)</)?.[1]?.trim();
      if (!name) continue; // 商品カード以外の /products/ リンク（カテゴリ等）を除外
      if (byId.has(slug)) continue;

      const image = inner.match(/src="(https:\/\/assets\.1kuji\.com\/[^"]+)"/)?.[1] ?? null;
      // 店頭販売の発売日が先に来る。最初の .date を発売日として使う。
      const dateText = inner.match(/class="date">([^<]+)</)?.[1]?.trim() ?? null;

      byId.set(slug, {
        source: "ichiban_kuji",
        sourceId: slug,
        title: name,
        genre: "一番くじ",
        subGenre: null,
        eventType: "発売",
        eventDate: dateText ? parseJapaneseFullDate(dateText) : null,
        eventDateText: dateText,
        price: null,
        url: `https://1kuji.com/products/${slug}`,
        imageUrl: image,
      });
    }
    await sleep(400);
  }

  const items = [...byId.values()];

  // 一覧では商品名止まりで“何が当たるか”に届かない。各商品の詳細ページを開いて
  // 各等賞一覧（A賞〜ラストワン賞＝二次相場の核）を抽出し highlights に載せる。
  // 一番くじは必ず抽選(くじ)で当たる形式なので hasLottery=true を立て、抽選タブでも拾う。
  // レート制限つき・失敗時はその商品だけ深掘りを諦めて一覧情報は活かす（壊さない）。
  for (const item of items) {
    try {
      const html = await fetchHtml(item.url);
      // 採算計算の前提＝1回いくら／どこで引けるか。読めた時だけ入れる（推測はしない）。
      item.price = extractKujiFee(html);
      item.salesChannel = extractKujiStores(html);
      const prizes = extractKujiPrizes(html);
      if (prizes.length) {
        item.highlights = formatKujiHighlights(prizes);
        item.hasLottery = true;
        // 各等賞を構造化（賞ラベル/賞品名/画像）してJSONで保持。相場(resale*)は
        // 発売済み品にだけ後付けするので、ここでは名前・画像まで（scrape:kuji:prices で相場付与）。
        item.prizes = JSON.stringify(prizes);
      }
    } catch {
      // 詳細取得に失敗しても一覧情報（商品名・発売日・画像）は活かす
    }
    await sleep(400);
  }

  return items;
}
