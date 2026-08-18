import { ScrapedItem } from "./types";
import { todayJst } from "../lib/date";
import { fetchHtml, resolveMonthDay, sleep } from "./util";
import { rakutenSearchRawUrl } from "../lib/outbound";
import { decodeHtmlEntities } from "./aggregatorUtil";

// ガンプラ再販カレンダー（リーチャのガンプラ再販情報 / harmonizers-jp.com）。
// 実測（2026-08-15）: 月別記事に**169行/月**の再販・新発売キットが
//   <tr><td><li><a href="#ID">商品名 【新発売】[8月延期]</a></li></td><td>08/10(月)</td></tr>
// で並び、ページ内アンカー先 <td id="ID">名前</td><td>価格(数字)</td><td>日付</td> に価格がある。
// ガンプラの店頭再販は転売の定番（再販日に定価で確保→プレ値）で、既存 figisland_pb（プレバン
// 予約）が持たない「店頭でいつ買えるか」を埋める。
//
// 【方針】非公式アグリ＝収集元は完全非公開。記事内リンクはDMMアフィリなので使わず、
// 購入導線は商品名の楽天検索に寄せる（tenbaiquest と同じ型）。
//
// 【発見経路】トップページに当月のカレンダー記事（本体/addition=追加/postponement=延期）への
// リンクが常設される。見つかった記事を全部読む（月が進めば新しい記事に置き換わる）。

const HOME = "https://harmonizers-jp.com/";
const CALENDAR_URL_RE =
  /https:\/\/harmonizers-jp\.com\/gunpla-restock-daily-calender-(?:addition-|postponement-)?[a-z]+-\d{4}\//g;

const ROW_RE = /<tr><td><li><a href="#([^"]+)">([\s\S]*?)<\/a><\/li><\/td><td[^>]*>(\d{1,2})\/(\d{1,2})[^<]*<\/td><\/tr>/g;
const PRICE_RE = /<td id="([^"]+)">[^<]*<\/td><td[^>]*>(\d{3,6})<\/td>/g;

export type GunplaRow = { id: string; name: string; isNew: boolean; month: number; day: number };

/** 商品名から編集タグ（【新発売】[8月延期][8月追加]等）を落とす。 */
export function cleanGunplaName(raw: string): { name: string; isNew: boolean } {
  const isNew = /【新発売】/.test(raw);
  const name = decodeHtmlEntities(raw)
    .replace(/【新発売】/g, "")
    .replace(/\[[^\]]*(?:延期|追加|変更)[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return { name, isNew };
}

/** カレンダー記事から行を取り出す（純関数・selftest対象）。 */
export function parseGunplaCalendar(html: string): { rows: GunplaRow[]; prices: Map<string, number> } {
  const body = html.slice(html.indexOf("</head>"));
  const rows: GunplaRow[] = [];
  for (const m of body.matchAll(ROW_RE)) {
    const { name, isNew } = cleanGunplaName(m[2].replace(/<[^>]+>/g, " "));
    if (!name) continue;
    rows.push({ id: m[1], name, isNew, month: Number(m[3]), day: Number(m[4]) });
  }
  const prices = new Map<string, number>();
  for (const m of body.matchAll(PRICE_RE)) prices.set(m[1], Number(m[2]));
  return { rows, prices };
}

export async function scrapeGunplaResale(): Promise<ScrapedItem[]> {
  const top = await fetchHtml(HOME);
  const urls = [...new Set(top.match(CALENDAR_URL_RE) ?? [])];

  const today = todayJst();
  const cutoff = today.getTime() - 3 * 86_400_000; // 過ぎた再販は3日で消す

  const byId = new Map<string, ScrapedItem>();
  for (const url of urls) {
    let html: string;
    try {
      html = await fetchHtml(url);
    } catch {
      continue;
    }
    await sleep(500);
    const { rows, prices } = parseGunplaCalendar(html);
    for (const r of rows) {
      if (byId.has(r.id)) continue;
      const date = resolveMonthDay(r.month, r.day, today);
      if (date.getTime() < cutoff) continue;
      const yen = prices.get(r.id);
      byId.set(r.id, {
        source: "gunpla_resale",
        sourceId: r.id,
        title: r.name,
        genre: "プラモ",
        subGenre: null,
        eventType: r.isNew ? "発売" : "再販",
        eventDate: date,
        eventDateText: null,
        price: yen ? `${yen.toLocaleString()}円` : null,
        // 収集元は非公開・記事内リンクはアフィリ＝商品名の楽天検索を導線にする。
        // **保存するのは素の検索URL。** アフィリ化は画面に出す瞬間だけ（outbound.ts の注意書き）。
        url: rakutenSearchRawUrl(r.name),
        imageUrl: null,
      });
    }
  }
  return [...byId.values()];
}
