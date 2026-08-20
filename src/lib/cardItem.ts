import { proxiedImageUrl } from "./imageProxy";
import { isLotteryItem } from "./itemFilter";
import { isOnlineItem } from "./channel";
import { cleanListTitle } from "./title";

/**
 * 商品カードに渡してよい形。**ここに無い列は画面にもブラウザにも出さない。**
 *
 * なぜ型を分けるか（2026-08-18 実測）: トップページは `items` をクライアント側の
 * ItemBrowser にそのまま渡していたので、**カードが表示に使わない `url` と `imageUrl` まで
 * HTMLに埋め込まれて配信されていた**。画面には1つも出していないのに、ページのソースを
 * 開けば収集元が全部読めた状態:
 *   collabo-cafe.com 835回 / ota-goods.info 441回 / figisland.net 348回 /
 *   kore-tore.com 26回 / snkrdunk.com 20回 / channel-tono.blog.jp 7回（トップ1枚あたり）
 * 「リンクを出さない」だけでは非公開にならない。**渡さない**のが唯一の方法。
 *
 * 画像は `image`（`/i/<商品ID>?v=…`＝自ドメイン経由）だけを持つ。元の画像URLは
 * サーバの中に留まる（src/lib/imageProxy.ts）。
 *
 * **`source`（収集元の内部名）も持たない。** これも配信物に出ていた（実測: figisland 516回・
 * collabo_cafe 393回・torecasoku 240回・gunpla_resale 122回・nyuka_now 74回・tenbaiquest 21回）。
 * 内部名は収集元そのものの名前なので、URLを消しても名前が残れば非公開にならない。
 * 収集元名が要る処理（タイトル整形・抽選判定）は**サーバーで済ませて結果だけ渡す**。
 */
export type CardItem = {
  id: number;
  /** 表示用に整形済みのタイトル（`cleanListTitle` 済み）。 */
  title: string;
  genre: string;
  subGenre: string | null;
  eventType: string;
  /** ISO文字列（クライアントへ渡すため）。 */
  eventDate: string | null;
  eventDateText: string | null;
  price: string | null;
  /** 自ドメイン経由の画像URL。無い時は null（NoImage を出す）。 */
  image: string | null;
  /** 抽選として扱うか。**収集元名を使う判定なのでサーバーで済ませる**（ブラウザには送らない）。 */
  lottery: boolean;
  /** 入手経路が「日本の公式オンラインストア/オンライン抽選」と裏取りできた行（英語版のタグ用）。
   *  判定は url/officialUrl を使うのでサーバーで済ませ、真偽値だけ渡す（lottery と同じ形）。 */
  online: boolean;
  marketPrice?: number | null;
  marketPriceText?: string | null;
  highlights?: string | null;
  hasLottery?: boolean | null;
};

/** カードに渡せる形へ落とす。**収集元が割れる値（url / imageUrl）はここで捨てる。** */
export function toCardItem(row: {
  id: number;
  source: string;
  title: string;
  genre: string;
  subGenre: string | null;
  eventType: string;
  eventDate: Date | string | null;
  eventDateText: string | null;
  price: string | null;
  imageUrl: string | null;
  url?: string | null;
  officialUrl?: string | null;
  marketPrice?: number | null;
  marketPriceText?: string | null;
  highlights?: string | null;
  hasLottery?: boolean | null;
}): CardItem {
  return {
    id: row.id,
    // 整形もサーバーで済ませる（整形には収集元名が要るため）。
    title: cleanListTitle(row.source, row.title),
    genre: row.genre,
    subGenre: row.subGenre,
    eventType: row.eventType,
    eventDate:
      row.eventDate instanceof Date ? row.eventDate.toISOString() : (row.eventDate ?? null),
    eventDateText: row.eventDateText,
    price: row.price,
    image: proxiedImageUrl(row.id, row.imageUrl),
    lottery: isLotteryItem(row),
    online: isOnlineItem({ source: row.source, url: row.url ?? null, officialUrl: row.officialUrl ?? null }),
    marketPrice: row.marketPrice ?? null,
    marketPriceText: row.marketPriceText ?? null,
    highlights: row.highlights ?? null,
    hasLottery: row.hasLottery ?? null,
  };
}
