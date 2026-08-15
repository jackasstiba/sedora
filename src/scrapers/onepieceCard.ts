import { ScrapedItem } from "./types";
import { fetchHtml } from "./util";
import { stripTags } from "./aggregatorUtil";

// ONE PIECEカードゲーム公式（onepiece-cardgame.com）の商品ラインナップ。
// 実測（2026-08-15）: /products/ は静的HTMLで、各商品が
//   <a href="…/products/boosters/op17/" class="linkListColItem">
//     <img class="lazy" data-src="/onepiececg/…/img_item01.webp">
//     <span class="linkListColCat">ブースター</span>
//     <h4 class="linkListColTitle">ブースターパック 世界最強の戦士【OP-17】</h4>
//     <time class="newsDate" datetime="2026-08-22">2026.08.22(土)</time>
//     <span class="data">240円(税込)</span>
// の形で並ぶ。datetime は "2026-08-22"（日精度）と "2026-10"（月精度）の2形。
// 背景: トレカで最需要級のワンピカードが従来 Xミラー頼みで19件・未来2件しか無かった
// （torecamap は更新が遅い）。ポケカ公式(pokemonCard.ts)と同じ「公式で補強」の型。

const LIST_URL = "https://www.onepiece-cardgame.com/products/";
const BASE = "https://www.onepiece-cardgame.com";
const RECENT_DAYS = 30; // 発売から30日より古いものは取り込まない（全期間の商品一覧のため）

const ITEM_RE = /<a href="([^"]+)"[^>]*class="linkListColItem"[\s\S]*?<\/a>/g;

function abs(url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  return BASE + (url.startsWith("/") ? url : "/" + url);
}

export type OnePieceProduct = {
  url: string;
  title: string;
  cat: string | null;
  date: Date | null; // 日精度のみ
  monthText: string | null; // 月精度 "2026年10月発売予定"
  price: string | null;
  imageUrl: string | null;
};

export function parseOnePieceProducts(html: string): OnePieceProduct[] {
  const out: OnePieceProduct[] = [];
  for (const m of html.matchAll(ITEM_RE)) {
    const block = m[0];
    const title = block.match(/linkListColTitle[^>]*>([\s\S]*?)<\/h4>/);
    if (!title) continue;
    const cat = block.match(/linkListColCat[^>]*>([\s\S]*?)<\/span>/);
    // 精度は**表示文言**で決める。datetime 属性は月しか公表していない商品にも
    // "2026-10-01" と日を合成して入っている（実測: EB-05 の表示は「2026.10」）。
    // 属性を信じると、サイトが約束していない特定日を約束してしまう（ミス15と同型）。
    const dt = block.match(/<time[^>]+datetime="(\d{4})-(\d{1,2})(?:-(\d{1,2}))?"[^>]*>([^<]*)<\/time>/);
    let date: Date | null = null;
    let monthText: string | null = null;
    if (dt) {
      const shownDay = /^\s*\d{4}\.\d{1,2}\.\d{1,2}/.test(dt[4]);
      if (dt[3] && shownDay) date = new Date(Date.UTC(Number(dt[1]), Number(dt[2]) - 1, Number(dt[3])));
      else monthText = `${dt[1]}年${Number(dt[2])}月発売予定`;
    }
    const price = block.match(/linkListColPrice[\s\S]*?class="data"[^>]*>([\s\S]*?)<\/span>/);
    const img = block.match(/data-src="([^"]+)"/);
    out.push({
      url: abs(m[1]),
      title: stripTags(title[1]),
      cat: cat ? stripTags(cat[1]) : null,
      date,
      monthText,
      price: price ? stripTags(price[1]).replace(/\(税込\)/, "") : null,
      imageUrl: img ? abs(img[1]) : null,
    });
  }
  return out;
}

/** 掲載判定＋行の組み立て（純関数・selftest対象）。 */
export function buildOnePieceItem(p: OnePieceProduct, reference = new Date()): ScrapedItem | null {
  if (p.date) {
    const age = (reference.getTime() - p.date.getTime()) / 86_400_000;
    if (age > RECENT_DAYS) return null;
  } else if (p.monthText) {
    const ym = p.monthText.match(/(\d{4})年(\d{1,2})月/);
    if (!ym) return null;
    const endOfMonth = new Date(Date.UTC(Number(ym[1]), Number(ym[2]), 0));
    if (endOfMonth.getTime() < reference.getTime()) return null;
  } else {
    return null; // 発売日の無い行（発売済みアクセサリ等）は載せない
  }

  // sourceId は商品ページのパス（/products/boosters/op17/ → boosters/op17）
  const sourceId = p.url
    .replace(BASE, "")
    .replace(/^\/products\//, "")
    .replace(/\/+$/, "");
  if (!sourceId) return null;

  return {
    source: "onepiece_card",
    sourceId,
    title: p.title,
    genre: "トレカ",
    subGenre: "ワンピースカード",
    eventType: "発売",
    eventDate: p.date,
    eventDateText: p.date ? null : p.monthText,
    price: p.price,
    url: p.url,
    imageUrl: p.imageUrl,
  };
}

export async function scrapeOnePieceCard(): Promise<ScrapedItem[]> {
  const html = await fetchHtml(LIST_URL);
  const items: ScrapedItem[] = [];
  const seen = new Set<string>();
  for (const p of parseOnePieceProducts(html)) {
    const item = buildOnePieceItem(p);
    if (item && !seen.has(item.sourceId)) {
      seen.add(item.sourceId);
      items.push(item);
    }
  }
  return items;
}
