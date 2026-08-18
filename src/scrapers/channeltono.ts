import { ScrapedItem } from "./types";
import { classifyGenre, extractDateAndEventFromText, fetchHtml, sleep } from "./util";
import { crawlPages, lastIsOlderThan } from "./crawl";
import { todayJst } from "../lib/date";
import { cleanStoreUrl } from "./aggregatorUtil";

const BASE_URL = "https://channel-tono.blog.jp/";

/**
 * 何日分の記事を毎回さらい直すか。**ページ数ではなく暦で決める。**
 *
 * 実測（2026-08-18）: このブログは **25記事/日**（直近14日で355記事・多い日は39記事）で、
 * 1ページ15記事。旧実装の「3ページ」は **1.8日分**しかなく、巡回が1日空いた分から静かに
 * 落ちていた（収集元の直近14日 355件のうち **40件が未取込**。うち29件は 8/04 の1日に集中＝
 * その日は45記事の窓を超えて投稿されていた）。channeltono は「受付終了を消す」対象ソースでは
 * ないので、**落ちた記事は後から入り直すこともない**。
 *
 * 更新は手動なので巡回の間隔は一定にならない（実績で最大3日空いている）。10日 ≒ 250記事 ≒
 * 17ページで、最悪の間隔の3倍以上の余裕がある。これを超えて空いた場合は取りこぼすが、
 * その時は上限(MAX_PAGES)ではなく**日数の設計**が足りていないので、ここを上げる。
 */
const RECENT_DAYS = 10;

/** 安全弁。10日分は実測17ページなので、投稿ペースが倍になっても届く。 */
const MAX_PAGES = 40;

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

/** 一覧ページに埋まっている記事レコード（新しい順に並ぶ）。 */
type Article = { id: string; permalink: string; title: string; subGenre: string | null; date: string };

/** 一覧ページの JS 変数から記事を取り出す（純関数）。 */
export function parseChanneltonoList(html: string): Article[] {
  const out: Article[] = [];
  for (const m of html.matchAll(ARTICLE_PUSH_RE)) {
    const [, id, permalink, rawTitle, rawCategories, date] = m;
    const categories = extractCategoryNames(rawCategories);
    out.push({
      id,
      permalink,
      title: unescapeJsString(rawTitle),
      subGenre: categories[1] || categories[0] || null,
      date,
    });
  }
  return out;
}

/** 記事の投稿日時（"2026-08-18 10:55:07" JST）をミリ秒に。読めなければ NaN。 */
function postedAtMs(a: Article): number {
  return new Date(`${a.date.replace(" ", "T")}+09:00`).getTime();
}

export async function scrapeChanneltono(): Promise<ScrapedItem[]> {
  const cutoff = todayJst().getTime() - RECENT_DAYS * 86_400_000;
  const articles = await crawlPages<Article>({
    label: "channeltono",
    urlOf: (p) => (p === 1 ? BASE_URL : `${BASE_URL}?p=${p}`),
    parse: parseChanneltonoList,
    keyOf: (a) => a.id,
    isPageOld: lastIsOlderThan(postedAtMs, cutoff),
    maxPages: MAX_PAGES,
    sleepMs: 500,
  });

  const items: ScrapedItem[] = articles.map((a) => {
    // 年の解決は**記事の投稿日**を基準にする。「今日」基準だと、数ヶ月前の記事に書かれた
    // 過去の日付が「まだ来ていない日」と解釈されて翌年に倒れる（rarecheck で実測7件）。
    const { date: eventDate, eventType, dateText } = extractDateAndEventFromText(a.title, a.date);
    return {
      source: "channeltono",
      sourceId: a.id,
      title: a.title,
      genre: classifyGenre(`${a.subGenre ?? ""} ${a.title}`),
      subGenre: a.subGenre,
      eventType: eventType ?? "情報",
      eventDate,
      eventDateText: dateText ?? (a.date ? `投稿日: ${a.date.slice(0, 10)}` : null),
      price: null,
      url: a.permalink,
      imageUrl: null,
    };
  });

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
