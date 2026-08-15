import type { MetadataRoute } from "next";
import { getSitemapItemRefs, getGenreList, getMonthsWithItems } from "@/lib/seo";
import { getTcgTitleCounts } from "@/lib/tcg";
import { nowInstant } from "@/lib/date";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const [genres, months, items, tcgTitles] = await Promise.all([
    getGenreList(),
    getMonthsWithItems(),
    getSitemapItemRefs(),
    getTcgTitleCounts(),
  ]);

  const now = nowInstant();

  const entries: MetadataRoute.Sitemap = [
    { url: base, lastModified: now, changeFrequency: "daily", priority: 1 },
    // /premium は 2026-08-10 に取り下げ（lib/seo.ts の getPremiumItems のコメント参照）。
    // 消したページを sitemap に残すと 404 を自分から検索エンジンに申告することになる。
    { url: `${base}/lottery`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
  ];

  for (const g of genres) {
    entries.push({
      url: `${base}/genre/${encodeURIComponent(g)}`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.8,
    });
  }

  for (const m of months) {
    entries.push({
      url: `${base}/release/${m}`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.7,
    });
  }

  for (const t of tcgTitles) {
    if (t.count < 2) continue; // 事前生成(generateStaticParams)と同じ閾値
    entries.push({
      url: `${base}/tcg/${encodeURIComponent(t.label)}`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.8,
    });
  }

  for (const it of items) {
    entries.push({
      url: `${base}/items/${it.id}`,
      lastModified: it.scrapedAt,
      changeFrequency: "weekly",
      priority: 0.6,
    });
  }

  return entries;
}
