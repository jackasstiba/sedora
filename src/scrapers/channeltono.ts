import { ScrapedItem } from "./types";
import { classifyGenre, extractDateAndEventFromText, fetchHtml, sleep } from "./util";
import { cleanStoreUrl } from "./aggregatorUtil";

const BASE_URL = "https://channel-tono.blog.jp/";
const MAX_PAGES = 3;

// 応募先として知っている抽選プラットフォーム。ここに一致するリンクが記事本文にあるときだけ
// officialUrl にする（観点B 2026-08-15: 「DMMとプレバンで…抽選受付中」というカードに応募先が
// 1本も無く、楽天検索しか出ない行き止まりだった）。ホワイトリスト方式＝知らないホストに
// 「公式ページ」の断定を足さない。Amazonアフィリ等の物販リンクは対象外。
const RAFFLE_HOSTS = /(^|\.)(p-bandai\.jp|dmm\.com|al\.dmm\.com|1kuji\.com|bsp-prize\.jp)$/i;

/** 記事本文から既知の抽選プラットフォームへのリンクを1本選ぶ（無ければ null）。 */
export function extractRaffleUrl(articleHtml: string): string | null {
  for (const m of articleHtml.matchAll(/<a[^>]+href="(https?:\/\/[^"]+)"/g)) {
    let href: string;
    try {
      href = m[1].replace(/&amp;/g, "&");
      if (!RAFFLE_HOSTS.test(new URL(href).hostname)) continue;
    } catch {
      continue;
    }
    const cleaned = cleanStoreUrl(href); // アフィリラッパー(al.dmm.com)は実URLに展開される
    if (cleaned && RAFFLE_HOSTS.test(new URL(cleaned).hostname)) return cleaned;
  }
  return null;
}

const ARTICLE_PUSH_RE =
  /ld_blog_vars\.articles\.push\(\{\s*id\s*:\s*'(\d+)'\s*,\s*permalink\s*:\s*'([^']*)'\s*,\s*title\s*:\s*'((?:[^'\\]|\\.)*)'\s*,\s*categories\s*:\s*\[([^\]]*)\]\s*,\s*date\s*:\s*'([^']*)'\s*\}\s*\);/g;

function extractCategoryNames(raw: string): string[] {
  const names: string[] = [];
  const re = /name\s*:\s*'([^']*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    if (m[1]) names.push(m[1]);
  }
  return names;
}

function unescapeJsString(s: string): string {
  return s.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

export async function scrapeChanneltono(): Promise<ScrapedItem[]> {
  const items: ScrapedItem[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = page === 1 ? BASE_URL : `${BASE_URL}?p=${page}`;
    const html = await fetchHtml(url);

    let matchCount = 0;
    for (const m of html.matchAll(ARTICLE_PUSH_RE)) {
      matchCount++;
      const [, id, permalink, rawTitle, rawCategories, date] = m;
      const title = unescapeJsString(rawTitle);
      const categories = extractCategoryNames(rawCategories);
      const subGenre = categories[1] || categories[0] || null;

      // 年の解決は**記事の投稿日**を基準にする。「今日」基準だと、数ヶ月前の記事に書かれた
      // 過去の日付が「まだ来ていない日」と解釈されて翌年に倒れる（rarecheck で実測7件）。
      const { date: eventDate, eventType, dateText } = extractDateAndEventFromText(title, date);

      items.push({
        source: "channeltono",
        sourceId: id,
        title,
        genre: classifyGenre(`${subGenre ?? ""} ${title}`),
        subGenre,
        eventType: eventType ?? "情報",
        eventDate,
        eventDateText: dateText ?? (date ? `投稿日: ${date.slice(0, 10)}` : null),
        price: null,
        url: permalink,
        imageUrl: null,
      });
    }
    if (matchCount === 0) break;

    await sleep(500);
  }

  // 応募先の付与。対象は掲載される可能性のある行（日付あり）のうち抽選のものだけに絞り、
  // 記事本文を1回ずつ取得して既知プラットフォームのリンクを拾う（全記事巡回はしない）。
  for (const it of items) {
    if (!it.eventDate) continue;
    if (!(it.eventType === "抽選" || /抽選/.test(it.title))) continue;
    try {
      const article = await fetchHtml(it.url);
      it.officialUrl = extractRaffleUrl(article);
    } catch {
      // 記事が取れなくても掲載自体は続ける（応募先が無いだけ）
    }
    await sleep(400);
  }

  return items;
}
