import { ScrapedItem } from "./types";
import { fetchHtml, sleep } from "./util";

// ポケモン公式サイトのグッズ一覧。ページはSPAだが、裏で叩いているJSON APIを直接取得する。
// start_date は「登場/発売日」で直近分も過去日付になりがち（＝予定ではなく“今買える新商品”）。
// このサイトは過去イベントを表示から除外するため、実日付を入れると全部消えてしまう。
// そこで eventDate は null（＝常時表示の新着扱い）にし、日付は eventDateText に「登場 M/D」で残す。
// 直近 RECENT_DAYS 日分だけを新着として取り込む。
const API = "https://www.pokemon.co.jp/api/goods/index/?limit=20&pokecen=0&page=";
const MAX_PAGES = 4;
const RECENT_DAYS = 30;

type ApiItem = {
  id: number;
  title: string;
  img_1: string | null;
  start_date: string | null; // "2026.07.17"
  uniq: string | null;
  full_uniq: string | null;
  pokecen: number; // 1 = ポケモンセンター限定
};

/** "2026.07.17" -> Date */
function parseDotDate(s: string | null): Date | null {
  const m = s?.match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
  if (!m) return null;
  // 暦日は UTC 0時で作る（本番のUTC環境で1日ズレないように）
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export async function scrapePokemonGoods(): Promise<ScrapedItem[]> {
  const items: ScrapedItem[] = [];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RECENT_DAYS);

  for (let page = 1; page <= MAX_PAGES; page++) {
    const json = JSON.parse(await fetchHtml(API + page)) as { results?: ApiItem[] };
    const results = json.results ?? [];
    if (results.length === 0) break;

    let anyRecent = false;
    for (const r of results) {
      const date = parseDotDate(r.start_date);
      if (date && date < cutoff) continue; // 古すぎる新商品は取り込まない
      anyRecent = true;

      const url = r.full_uniq || r.uniq;
      if (!url || !r.title) continue;

      items.push({
        source: "pokemon_goods",
        sourceId: String(r.id),
        title: r.title,
        genre: "ポケモン",
        subGenre: r.pokecen === 1 ? "ポケセン限定" : "グッズ",
        eventType: "発売",
        eventDate: null,
        eventDateText: r.start_date ? `登場 ${r.start_date.replace(/\./g, "/")}` : null,
        price: null,
        url,
        imageUrl: r.img_1 || null,
      });
    }

    // 日付降順なので、このページに直近分が1件も無ければ以降も全て古い
    if (!anyRecent) break;
    await sleep(500);
  }

  // 古い順に返す。登録順=id順になり、新しい商品ほど大きいidになるので、
  // 新着順（id降順）で「登場日が新しいグッズ」が上に来る。
  return items.reverse();
}
