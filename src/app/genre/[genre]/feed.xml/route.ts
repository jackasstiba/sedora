import { buildRss } from "@/lib/rss";

export const revalidate = 1800; // 30分キャッシュ

export async function GET(_req: Request, { params }: { params: Promise<{ genre: string }> }) {
  const { genre } = await params;
  const xml = await buildRss(decodeURIComponent(genre));
  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
