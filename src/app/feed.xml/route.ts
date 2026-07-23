import { buildRss } from "@/lib/rss";

export const revalidate = 1800; // 30分キャッシュ

export async function GET() {
  const xml = await buildRss();
  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
