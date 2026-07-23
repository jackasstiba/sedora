import type { MetadataRoute } from "next";
import { getAllItemRefs, getGenreList, getMonthsWithItems } from "@/lib/seo";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const [genres, months, items] = await Promise.all([
    getGenreList(),
    getMonthsWithItems(),
    getAllItemRefs(),
  ]);

  const now = new Date();

  const entries: MetadataRoute.Sitemap = [
    { url: base, lastModified: now, changeFrequency: "daily", priority: 1 },
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
