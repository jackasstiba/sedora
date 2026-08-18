import { prisma } from "@/lib/prisma";
import { parsePrizesJson } from "@/lib/prizes";

/**
 * 商品画像を自分のドメインから配る（`/i/<商品ID>?v=<版>`、各賞は `?p=<番号>&v=<版>`）。
 *
 * 目的は2つ（理由の全文は src/lib/imageProxy.ts）:
 *   ・**収集元を出さない。** 直リンクしていた頃は画像のホスト名で巡回先が全部割れていた。
 *   ・**他所の帯域を借り続けない。** 版つきURL＋長期キャッシュで、取りに行くのは実質1回。
 *
 * 取りに行く先は**DBに保存済みのURLだけ**（リクエストのクエリからURLは受け取らない）。
 * URLを受け取る作りにすると、誰でもこのサーバを踏み台に任意のホストへ要求を出せる。
 */

// 画像1枚の上限。これを超える応答は打ち切る（巨大な原寸画像で関数が詰まるのを防ぐ）。
const MAX_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** 取得に失敗したときに返す透明画像。**元URLへ転送してはいけない**（転送先で収集元が割れる）。 */
const FALLBACK = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

function fallback(): Response {
  return new Response(new Uint8Array(FALLBACK), {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      // 失敗は一時的なことがあるので短命にする（次の表示でもう一度取りに行く）。
      "Cache-Control": "public, max-age=60",
    },
  });
}

export async function GET(request: Request, ctx: RouteContext<"/i/[id]">) {
  const { id } = await ctx.params;
  const itemId = Number(id);
  if (!Number.isInteger(itemId) || itemId <= 0) return fallback();

  const prizeParam = new URL(request.url).searchParams.get("p");
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { imageUrl: true, prizes: true },
  });
  if (!item) return fallback();

  let src: string | null = item.imageUrl;
  if (prizeParam !== null) {
    const i = Number(prizeParam);
    const prizes = parsePrizesJson(item.prizes);
    src = Number.isInteger(i) && i >= 0 ? (prizes?.[i]?.image ?? null) : null;
  }
  if (!src || !/^https?:\/\//i.test(src)) return fallback();

  try {
    const res = await fetch(src, {
      headers: { "User-Agent": UA, Accept: "image/*,*/*;q=0.8" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
    const type = res.headers.get("content-type") ?? "";
    // 画像以外（403のHTML・ログインページ等）を画像として配らない。
    if (!res.ok || !type.startsWith("image/")) return fallback();
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return fallback();

    return new Response(buf, {
      status: 200,
      headers: {
        "Content-Type": type,
        // URLに版(v=)が入っているので、中身が変わることはない＝1年キャッシュしてよい。
        "Cache-Control": "public, max-age=3600, s-maxage=31536000, immutable",
        // 収集元のサーバが付けてくる情報は転送しない（ヘッダからも辿らせない）。
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return fallback();
  }
}
