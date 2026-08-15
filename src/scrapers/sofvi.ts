import { ScrapedItem } from "./types";
import { todayJst } from "../lib/date";
import { fetchHtml } from "./util";
import { stripTags } from "./aggregatorUtil";
import { rakutenSearchUrl } from "../lib/outbound";

// sofvi.tokyo（メディコム・トイ運営のソフビ総合情報サイト）。
// 実測（2026-08-15）: トップの新着一覧が
//   <li class="date">2026-08-15</li> … <h4 class="title"><a href="URL">見出し</a></h4>
// で並び、見出しに商品名（「」内）とブランド（［］内）、抽選記事は「抽選受付締切は16日まで！」
// のような**日だけの締切**が入る（月は記事日付から補う）。
// ソフビ・アートトイジャンル（現在ほぼ空）の供給源。
//
// 【掲載基準】ニュース見出しをそのまま商品名にしない（実況見出しの再来になる）。
// ［ブランド］と「商品名」を組み立てられて、かつ**締切か発売日が立てられる記事だけ**載せる。
// 発売済みレポート（「出現！」「現る！」等・日付なし）は載せない。

const HOME = "https://sofvi.tokyo/";

const CARD_RE =
  /<li class="date">(\d{4})-(\d{2})-(\d{2})<\/li>[\s\S]{0,400}?<h4 class="title"><a href="(https:\/\/sofvi\.tokyo\/[^"]+)">([\s\S]*?)<\/a><\/h4>/g;

export type SofviCard = { posted: Date; url: string; headline: string };

export function parseSofviCards(html: string): SofviCard[] {
  const out: SofviCard[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(CARD_RE)) {
    const url = m[4];
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({
      posted: new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))),
      url,
      headline: stripTags(m[5]),
    });
  }
  return out;
}

/** 見出しから「［ブランド］＋「商品名」」を組み立てる。作れなければ null（載せない）。 */
export function sofviProductName(headline: string): string | null {
  const brands = [...headline.matchAll(/［([^］]{2,40})］/g)].map((m) => m[1]);
  const quoted = [...headline.matchAll(/「([^」]{2,60})」/g)].map((m) => m[1]);
  if (quoted.length === 0) return null;
  const product = quoted[quoted.length - 1]; // 商品名は見出し末尾側の「」に来る（実測）
  if (product.length < 3) return null;
  const brand = brands[brands.length - 1];
  return brand ? `${brand} ${product}` : product;
}

/** 見出しから期日を立てる。①「締切は16日まで」＝記事日付の月で補完（過ぎていれば翌月）
 *  ②「M月D日発売/受注開始」型。どちらも無ければ null（載せない）。 */
export function sofviEventInfo(
  headline: string,
  posted: Date
): { eventType: string; date: Date } | null {
  const norm = headline.normalize("NFKC");
  const dayOnly = norm.match(/締切は?(\d{1,2})日/);
  if (dayOnly) {
    const day = Number(dayOnly[1]);
    let d = new Date(Date.UTC(posted.getUTCFullYear(), posted.getUTCMonth(), day));
    if (d.getTime() < posted.getTime()) d = new Date(Date.UTC(posted.getUTCFullYear(), posted.getUTCMonth() + 1, day));
    return { eventType: "抽選", date: d };
  }
  const md = norm.match(/(\d{1,2})月(\d{1,2})日[^、。]{0,10}?(発売|受注|予約|抽選|受付)/);
  if (md) {
    // 年は記事日付基準（未来寄り: 記事月より2ヶ月以上前の月は翌年）
    let y = posted.getUTCFullYear();
    if (Number(md[1]) < posted.getUTCMonth() + 1 - 2) y += 1;
    return {
      eventType: md[3] === "発売" ? "発売" : md[3] === "抽選" ? "抽選" : "予約",
      date: new Date(Date.UTC(y, Number(md[1]) - 1, Number(md[2]))),
    };
  }
  return null;
}

export async function scrapeSofvi(): Promise<ScrapedItem[]> {
  const html = await fetchHtml(HOME);
  const today = todayJst();
  const cutoff = today.getTime() - 3 * 86_400_000;

  const items: ScrapedItem[] = [];
  for (const c of parseSofviCards(html)) {
    const name = sofviProductName(c.headline);
    if (!name) continue;
    const info = sofviEventInfo(c.headline, c.posted);
    if (!info || info.date.getTime() < cutoff) continue;

    const slug = c.url.replace(/\/$/, "").split("/").pop() ?? c.url;
    items.push({
      source: "sofvi",
      sourceId: slug,
      title: name,
      genre: "ソフビ・アートトイ",
      subGenre: null,
      eventType: info.eventType,
      eventDate: info.date,
      eventDateText: null,
      price: null,
      // 収集元の記事リンクはフロントに出さない方針＝導線は商品名の楽天検索。
      url: rakutenSearchUrl(name),
      imageUrl: null, // sofvi.tokyo ホストの画像を直リンクすると収集元が露見するため使わない
      hasLottery: info.eventType === "抽選",
      highlights: info.eventType === "抽選" ? `抽選受付 〜${info.date.getUTCMonth() + 1}/${info.date.getUTCDate()}` : null,
    });
  }
  return items;
}
