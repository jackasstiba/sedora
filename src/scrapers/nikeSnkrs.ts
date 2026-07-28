import { ScrapedItem } from "./types";
import { fetchHtml } from "./util";

// Nike SNKRS の抽選/LAUNCH（応募制）商品を収集する。
// 既存の snkrdunk は「発売カレンダー」で、抽選の応募期間・締切までは拾えていない。
// スニーカーの高相場は抽選が中心なので、ここで「抽選エントリ＋応募/発売日時」を補う。
//
// 取得方式: launchページは JS 描画SPA だが、Next.js の __NEXT_DATA__ に初期ステートが
// 埋め込まれており素の fetch で取得できる（pokemonGoods/pokemonCard と同じ「SPAだがJSON直取り」型）。
// ステートは props.pageProps.initialState に JSON文字列として二重エンコードされている。
const LAUNCH_URL = "https://www.nike.com/jp/launch";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

function extractNextData(html: string): Json | null {
  const m = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

// initialState は文字列(二重エンコード)のことも、稀にオブジェクトのこともある。両対応。
function getInitialState(next: Json): Json | null {
  const raw = next?.props?.pageProps?.initialState;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (raw && typeof raw === "object") return raw;
  return null;
}

// threads から productId -> SEOスラッグ を引けるようにする（商品URL生成用）。
function buildSlugMap(threads: Record<string, Json>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const th of Object.values(threads)) {
    const slug: string | undefined = th?.seo?.slug;
    if (!slug) continue;
    const ids: string[] =
      Array.isArray(th?.productIds) && th.productIds.length
        ? th.productIds
        : th?.productId
          ? [th.productId]
          : [];
    for (const id of ids) if (!map[id]) map[id] = slug;
  }
  return map;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

// ISO日時 -> JST(Asia/Tokyo)の暦日・時分。本番はUTCで動くため、時刻加算でJSTに寄せてから分解する。
function jstParts(iso: string): { y: number; mo: number; d: number; h: number; mi: number } {
  const t = new Date(iso).getTime() + 9 * 60 * 60 * 1000;
  const j = new Date(t);
  return {
    y: j.getUTCFullYear(),
    mo: j.getUTCMonth() + 1,
    d: j.getUTCDate(),
    h: j.getUTCHours(),
    mi: j.getUTCMinutes(),
  };
}

// 暦日は「時刻を持たない日」として UTC 0時で作る（util.ts の calDate と同じ規約）。
function calDateUtc(y: number, mo: number, d: number): Date {
  return new Date(Date.UTC(y, mo - 1, d));
}

// Nikeの日時は多くが「その日のUTC0時」＝日付のみ（実ドロップ時刻ではない）。
// UTC0時をJSTに寄せると偽の「9:00」になるため、時刻が実在するとき(UTCで非0時)だけ時刻を出す。
function hasRealTime(iso: string): boolean {
  const d = new Date(iso);
  return d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0;
}

function formatYen(price: unknown, currency: unknown): string | null {
  if (typeof price !== "number" || !isFinite(price)) return null;
  if (currency && currency !== "JPY") return `${price.toLocaleString("ja-JP")} ${currency}`;
  return `¥${price.toLocaleString("ja-JP")}`;
}

export async function scrapeNikeSnkrs(): Promise<ScrapedItem[]> {
  const html = await fetchHtml(LAUNCH_URL);
  const next = extractNextData(html);
  const state = next ? getInitialState(next) : null;
  const product = state?.product;
  const launchViews: Record<string, Json> = product?.launchViews?.data?.items ?? {};
  const products: Record<string, Json> = product?.products?.data?.items ?? {};
  const threads: Record<string, Json> = product?.threads?.data?.items ?? {};

  const slugMap = buildSlugMap(threads);
  const items: ScrapedItem[] = [];

  // 過去に落ちた抽選は載せない（サイト側でも過去は除外されるが二重防御）。
  const cutoff = Date.now() - 2 * 24 * 60 * 60 * 1000;

  // launchViews に載る＝抽選/LAUNCH（応募制）の商品だけを対象にする（通常先着販売は除外）。
  for (const [productId, entry] of Object.entries(launchViews)) {
    const p = products[productId];
    if (!p) continue;

    const commerce: string | undefined = p.commerceStartDate;
    if (!commerce) continue;

    const c = jstParts(commerce);
    const eventDate = calDateUtc(c.y, c.mo, c.d);
    if (eventDate.getTime() < cutoff) continue;

    // 応募締切(stopEntryDate)がある抽選(LEO/DAN型)はそれを、無い場合(LINE型=発売時抽選)は発売日時を見せる。
    let eventDateText: string;
    if (entry?.stopEntryDate) {
      const s = jstParts(entry.stopEntryDate);
      const time = hasRealTime(entry.stopEntryDate) ? ` ${s.h}:${pad2(s.mi)}` : "";
      eventDateText = `抽選応募締切 ${s.mo}/${s.d}${time}`;
    } else {
      const time = hasRealTime(commerce) ? ` ${c.h}:${pad2(c.mi)}` : "";
      eventDateText = `抽選 ${c.mo}/${c.d}${time}`;
    }

    const title: string = (p.title ?? "").trim();
    if (!title) continue;

    const styleColor: string | undefined = p.styleColor;
    const slug = slugMap[productId];

    items.push({
      source: "nike_snkrs",
      sourceId: styleColor || productId,
      title,
      genre: "スニーカー",
      subGenre: null,
      eventType: "抽選",
      eventDate,
      eventDateText,
      price: formatYen(p.currentPrice, p.currency),
      url: slug ? `${LAUNCH_URL}/t/${slug}` : LAUNCH_URL,
      imageUrl: typeof p.imageSrc === "string" ? p.imageSrc : null,
    });
  }

  return items;
}
