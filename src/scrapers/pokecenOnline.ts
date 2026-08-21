import { ScrapedItem } from "./types";
import { fetchHtml } from "./util";

// ポケモンセンターオンライン（pokemoncenter-online.com）＝**ポケモングッズ通販の一次情報**。
//
// 経緯（2026-08-21・[[Projects/sedori_radar_source_candidates]]）: 2026-07-23 の調査では
// 「JS描画SPAで空シェル」、S帯再挑戦の初手では「/lottery/ が403」で2度不可と判定していたが、
// **どちらも誤り**だった。403は存在しないパスを叩いただけで、現在のサイトは
// Salesforce Commerce Cloud（Demandware）の**サーバーレンダリング**＝素の fetch で
// 商品タイル（data-pid=JAN・商品名・価格・画像）まで全部返ってくる（実測）。
// 「不可」の記録は再挑戦するまで腐り続ける、の実例。
//
// 取得方式: 新商品検索（releaseType=1・新着順・sz=100）の1ページ。ページ送りはしない
// （最新100件で新着の窓として十分。start= は実測で効かない）。
// 抽選販売はお知らせ記事（/news/?id=YYYYMMDD・【抽選販売を実施する商品】ブロック）に
// 載るが、散文パースは開催中の実データでしか検証できないため v1 では扱わない。
//
// 【掲載方針】url は公式ストアの商品ページ（/<JAN>.html）＝直リンクしてよい。

const STORE = "https://www.pokemoncenter-online.com";
const LIST_URL = `${STORE}/search/?prefn1=releaseType&prefv1=1&srule=top-new-product&sz=100`;

export type PokecenTile = { pid: string; title: string; priceYen: number | null; imageUrl: string | null };

/** 検索結果の商品タイルを読む（純関数・selftest対象）。 */
export function parsePokecenTiles(html: string): PokecenTile[] {
  const out: PokecenTile[] = [];
  const seen = new Set<string>();
  const blocks = html.split(/<li class="product" data-pid="/).slice(1);
  for (const block of blocks) {
    const pid = block.match(/^(\d+)"/)?.[1];
    if (!pid || seen.has(pid)) continue;
    const title = block.match(/<p class="txt"><a[^>]*>([^<]+)<\/a>/)?.[1]?.replace(/\s+/g, " ").trim();
    if (!title) continue;
    seen.add(pid);
    const price = block.match(/class="price\s*"[^>]*>\s*<a[^>]*>\s*([\d,]+)\s*<small>円/)?.[1] ?? null;
    const img = block.match(/<img src="(https?:\/\/[^"]+)"/)?.[1] ?? null;
    out.push({ pid, title, priceYen: price ? Number(price.replace(/,/g, "")) : null, imageUrl: img });
  }
  return out;
}

/** タイトル → サイトのジャンル語彙。ポケカ関連はトレカへ（/tcg/ポケカ の器に入る）。 */
export function pokecenGenre(title: string): { genre: string; subGenre: string } {
  if (/ポケモンカードゲーム|拡張パック|構築デッキ|デッキシールド|カードボックス|プレイマット/.test(title)) {
    return { genre: "トレカ", subGenre: "ポケモンカード" };
  }
  return { genre: "ポケモン", subGenre: "ポケモンセンター" };
}

export async function scrapePokecenOnline(): Promise<ScrapedItem[]> {
  const html = await fetchHtml(LIST_URL);
  const tiles = parsePokecenTiles(html);
  // 0件は「新商品が無い」ではなくマークアップ変更・導線変更とみなして赤くする
  // （巡回失敗なら前回データが残り、3日で source_stale が知らせる）。
  if (tiles.length === 0) throw new Error("pokecen_online: 新商品タイルが0件（マークアップ変更を疑う）");

  return tiles.map((t) => {
    const { genre, subGenre } = pokecenGenre(t.title);
    return {
      source: "pokecen_online",
      sourceId: t.pid, // data-pid ＝ JAN そのもの＝安定キー
      title: t.title,
      genre,
      subGenre,
      // 新商品一覧に「今あること」が載せる根拠＝日付なし（チェックアウト可能な現行商品）。
      // 一覧から消えた行は scrape.ts の RECONCILE_UNDATED_SOURCES が突き合わせて消す。
      eventType: "発売",
      eventDate: null,
      eventDateText: null,
      price: t.priceYen ? `${t.priceYen.toLocaleString()}円` : null,
      url: `${STORE}/${t.pid}.html`,
      imageUrl: t.imageUrl,
    };
  });
}
