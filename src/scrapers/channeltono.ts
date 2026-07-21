import { ScrapedItem } from "./types";
import { classifyGenre, extractDateAndEventFromText, fetchHtml, sleep } from "./util";

const BASE_URL = "https://channel-tono.blog.jp/";
const MAX_PAGES = 3;

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

      const { date: eventDate, eventType, dateText } = extractDateAndEventFromText(title);

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

  return items;
}
