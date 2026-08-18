import * as cheerio from "cheerio";
import { ScrapedItem } from "./types";
import { classifyGenre, extractDateAndEventFromText } from "./util";
import { crawlPages, lastIsOlderThan } from "./crawl";
import { todayJst } from "../lib/date";

const BASE_URL = "https://rarecheck.one-cc.com/b/";

/**
 * 何日分さらい直すか（ページ数ではなく暦で決める＝crawl.ts の規約）。
 *
 * 実測（2026-08-18）: 1ページ10記事で、投稿ペースは**10記事 ≒ 7週間**（page1 が 8/07〜6/19）。
 * 旧実装の3ページは 3.5ヶ月分あったので**今は取りこぼしていない**が、固定ページ数のままだと
 * 収集元が更新頻度を上げた日に静かに追い越される（nyuka_now・channeltono が実際にそうなった）。
 * 90日 ≒ 6ページ。掲載スコープ（過去は直近60日まで）より広く取ってある。
 */
const RECENT_DAYS = 90;

/** 安全弁。90日分は実測6ページなので、投稿ペースが3倍になっても届く。 */
const MAX_PAGES = 20;

type Post = { sourceId: string; title: string; href: string; category: string; postedAt: string | null };

/** 一覧ページから記事を取り出す（新しい順・純関数）。 */
export function parseRarecheckList(html: string): Post[] {
  const $ = cheerio.load(html);
  const out: Post[] = [];
  $("#content[role='main'] > article.post").each((_, articleEl) => {
    const article = $(articleEl);
    const titleLink = article.find("header.entry-header h1.entry-title a").first();
    const title = titleLink.text().trim();
    const href = titleLink.attr("href") ?? "";
    if (!title || !href) return;
    out.push({
      sourceId: href.match(/p=(\d+)/)?.[1] ?? href,
      title,
      href,
      category: article.find("footer.entry-meta a[rel='category']").first().text().trim(),
      postedAt: article.find("footer.entry-meta time.entry-date").first().attr("datetime") ?? null,
    });
  });
  return out;
}

export async function scrapeRarecheck(): Promise<ScrapedItem[]> {
  const cutoff = todayJst().getTime() - RECENT_DAYS * 86_400_000;
  const posts = await crawlPages<Post>({
    label: "rarecheck",
    urlOf: (p) => (p === 1 ? BASE_URL : `${BASE_URL}?paged=${p}`),
    parse: parseRarecheckList,
    keyOf: (p) => p.sourceId,
    isPageOld: lastIsOlderThan((p) => (p.postedAt ? new Date(p.postedAt) : null), cutoff),
    maxPages: MAX_PAGES,
    sleepMs: 500,
  });

  return posts.map((p) => {
    // 年の解決は**記事の投稿日**を基準にする（「今日」基準だと過去の記事の日付が翌年に倒れる）
    const { date, eventType, dateText } = extractDateAndEventFromText(p.title, p.postedAt);
    return {
      source: "rarecheck",
      sourceId: p.sourceId,
      title: p.title,
      genre: classifyGenre(`${p.category} ${p.title}`),
      subGenre: p.category || null,
      eventType: eventType ?? "情報",
      eventDate: date,
      eventDateText: dateText ?? (p.postedAt ? `投稿日: ${p.postedAt.slice(0, 10)}` : null),
      price: null,
      url: p.href,
      imageUrl: null,
    };
  });
}
