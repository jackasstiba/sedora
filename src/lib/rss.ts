import { getItems, sourceLabel } from "./items";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(d: Date | null): string {
  return d ? new Date(d).toLocaleDateString("ja-JP") : "日付未定";
}

/**
 * 新着（初回発見）順のアイテムから RSS 2.0 を生成する。
 * genre 指定でそのジャンルだけのフィードにする（power user が自分の関心だけ購読できる）。
 */
export async function buildRss(genre?: string): Promise<string> {
  const items = (await getItems({ sort: "recent", genre })).slice(0, 50);

  const titleSuffix = genre ? `｜${genre}` : "";
  const feedUrl = genre
    ? `${SITE}/genre/${encodeURIComponent(genre)}/feed.xml`
    : `${SITE}/feed.xml`;
  const linkUrl = genre ? `${SITE}/genre/${encodeURIComponent(genre)}` : SITE;

  const entries = items
    .map((it) => {
      const link = `${SITE}/items/${it.id}`;
      const desc = `${it.eventType}: ${fmtDate(it.eventDate)}／${it.genre}${
        it.price ? `／${it.price}` : ""
      }／${sourceLabel(it.source)}`;
      return `    <item>
      <title>${esc(it.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <category>${esc(it.genre)}</category>
      <pubDate>${new Date(it.scrapedAt).toUTCString()}</pubDate>
      <description>${esc(desc)}</description>
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>レアレーダー${titleSuffix}｜レア・限定品の予約・発売・抽選スケジュール</title>
    <link>${linkUrl}</link>
    <atom:link href="${feedUrl}" rel="self" type="application/rss+xml" />
    <description>フィギュア・トレカ・スニーカー・一番くじ・コラボグッズなど、レア・限定アイテムの新着予約・発売情報をお届け。</description>
    <language>ja</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${entries}
  </channel>
</rss>`;
}
