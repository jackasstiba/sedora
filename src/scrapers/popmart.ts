import { ScrapedItem } from "./types";
import { jstCalDate } from "../lib/date";

// POP MART 日本公式オンラインストア（www.popmart.com/jp）＝**アートトイの一次情報**。
// Labubu（THE MONSTERS）等の入手困難シリーズを持つ、ソフビ・アートトイ枠の本丸。
//
// なぜAPIか（2026-08-21 実測・[[Projects/sedori_radar_popmart]]）: ページはRSCストリーミングの
// 骨組みだけで、curlで取れるHTMLには商品名もリンクも1件も無い（存在しないURLでも同じ見た目の
// 200が返る）。代わりに内部oRPC API（prod-apac-api.popmart.com/rpc）が無認証で開いており、
// 新商品カレンダーが発売日時つきの構造化JSONで取れる。テーマのclass名を追うより壊れにくい。
//
// 【掲載方針】url は公式ストアの商品ページ（一次情報）＝直リンクしてよい。
//
// ⚠ ヘッダの罠（実測）: `X-AREA: JP` は**大文字必須**。小文字 `jp` だと**エラーにならず
// 200のまま items:[] が返る**（サイレント空振り）。`X-DEVICE-TYPE: pc` が無いと 432。
// このため下の scrapePopmart は「0件なら throw」＝前回データを保つ側に倒す。

const RPC_BASE = "https://prod-apac-api.popmart.com/rpc";
const STORE = "https://www.popmart.com";

/** APIレスポンスのうち、この巡回が読むフィールドだけを書く。 */
export type PopmartCalendarItem = {
  id: string;
  name_trans?: Record<string, string>;
  slugTitle?: string;
  price?: number;
  currency?: string;
  tags?: string[];
  businessType?: string; // "shop"（通常販売）| "draw"（抽選）
  saleStartAt?: string | null; // ISO UTC。8月分は全て 02:00Z ＝ JST 11:00 発売
  show?: boolean;
  publish?: boolean;
  npcImages_trans?: Record<string, string>;
  bannerImages?: { link_trans?: Record<string, string> }[];
};

/** businessType → サイトの eventType 語彙（itemFilter.ts の STATUS_EVENT_TYPES にある語だけ使う）。 */
export function popmartEventType(businessType: string | undefined): string {
  return businessType === "draw" ? "抽選" : "発売";
}

/**
 * 商品URL。**サイト自身のルーター実装から写した**（JSチャンク内 `buildStorePickupProductUrl`）:
 *   shop … `/products/${slug}/${spuId}`（slugが無ければ `/products/${spuId}`）
 *   draw … `/pop-now/box-set/${slug}/${spuId}`
 * slug と id の順序を逆にすると、SPAは200のまま中身の無いページを出す（HTTPでは検出不能）。
 */
export function popmartProductUrl(businessType: string | undefined, slugTitle: string | undefined, id: string): string {
  const base = businessType === "draw" ? "/jp/pop-now/box-set" : "/jp/products";
  const slug = (slugTitle ?? "").trim();
  // "-" だけのslugが実在する（原神キャンパスシリーズ）。パスとしては有効だが空と同じ扱いにする。
  return slug && slug !== "-" ? `${STORE}${base}/${slug}/${id}` : `${STORE}${base}/${id}`;
}

/** 翻訳マップから最初に見つかった空でないURLを返す（ja優先）。 */
function firstTrans(map: Record<string, string> | undefined): string | null {
  if (!map) return null;
  for (const key of ["ja", "en-us", ...Object.keys(map)]) {
    const v = map[key]?.trim();
    if (v) return v;
  }
  return null;
}

/** 商品画像。npcImages（一覧サムネ）→ bannerImages の順で最初の実URLを借りる。 */
export function popmartImage(item: Pick<PopmartCalendarItem, "npcImages_trans" | "bannerImages">): string | null {
  const npc = firstTrans(item.npcImages_trans);
  if (npc) return npc;
  for (const banner of item.bannerImages ?? []) {
    const url = firstTrans(banner.link_trans);
    if (url) return url;
  }
  return null;
}

async function rpc<T>(path: string, input: unknown): Promise<T> {
  const res = await fetch(`${RPC_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-AREA": "JP", // 大文字必須（小文字はサイレント0件）
      "X-DEVICE-TYPE": "pc",
      "Accept-Language": "ja",
      Origin: STORE,
      Referer: `${STORE}/`,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    },
    body: JSON.stringify({ json: input }),
  });
  if (!res.ok) throw new Error(`popmart rpc ${path}: HTTP ${res.status}`);
  const data = (await res.json()) as { json: T };
  return data.json;
}

function toItem(p: PopmartCalendarItem): ScrapedItem | null {
  const title = (p.name_trans?.ja ?? p.name_trans?.["en-us"] ?? "").replace(/\s+/g, " ").trim();
  // 発売日時が無い行は入れない。日付なしで入れると「いま買える」の顔で永住する
  // （在庫連動の突き合わせを持たないため）。カレンダーは実測で全行 saleStartAt 持ち。
  if (!title || !p.saleStartAt) return null;
  if (p.show === false || p.publish === false) return null;
  const startMs = Date.parse(p.saleStartAt);
  if (!Number.isFinite(startMs)) return null;
  return {
    source: "popmart",
    sourceId: p.id,
    title,
    genre: "ソフビ・アートトイ",
    subGenre: null,
    eventType: popmartEventType(p.businessType),
    eventDate: jstCalDate(startMs),
    eventDateText: null,
    price: p.price ? `${p.price.toLocaleString()}円` : null,
    url: popmartProductUrl(p.businessType, p.slugTitle, p.id),
    imageUrl: popmartImage(p),
  };
}

/**
 * 新商品カレンダーを取りに行く（scrapePopmart と audit:facts の突合で共用）。
 * ページのHTMLは商品情報を一切含まない（RSCストリーミング）ので、popmart の「一次情報」は
 * このAPIのレスポンス＝店の商品データそのもの。突合もここに対して行う。
 */
export async function fetchPopmartCalendar(): Promise<PopmartCalendarItem[]> {
  const cal = await rpc<{ items: PopmartCalendarItem[] }>("/ec/spu/findNewProductCalendar", {
    limit: 100,
    businessTypes: ["shop", "draw"],
    homeVisible: true,
  });
  return cal.items ?? [];
}

export async function scrapePopmart(): Promise<ScrapedItem[]> {
  // 新商品カレンダー＝公式が「新商品」と言っている範囲そのもの（実測: 直近1ヶ月・22件）。
  // 未来の発売予定・抽選(draw)もここに混ざる設計（COMING_SOONタグ／businessType）。
  const cal = { items: await fetchPopmartCalendar() };
  const items = (cal.items ?? []).map(toItem).filter((x): x is ScrapedItem => x !== null);
  // 0件は「新商品が無い」ではなく取得の壊れ（X-AREA小文字化・API変更等）とみなして赤くする。
  // 巡回失敗なら upsert も削除も走らず前回データが残る＝3日で source_stale が知らせる。
  if (items.length === 0) throw new Error("popmart: カレンダーが0件（ヘッダ/API仕様の変化を疑う）");
  return items;
}
