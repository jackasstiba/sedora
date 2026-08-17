import { ScrapedItem } from "./types";
import { todayJst } from "../lib/date";
import { fetchHtml, sleep } from "./util";

// ポケモン公式サイトのグッズ一覧。ページはSPAだが、裏で叩いているJSON APIを直接取得する。
// start_date は「登場/発売日」で直近分も過去日付になりがち（＝予定ではなく“今買える新商品”）。
// このサイトは過去イベントを表示から除外するため、実日付を入れると全部消えてしまう。
// そこで eventDate は null（＝常時表示の新着扱い）にし、日付は eventDateText に「登場 M/D」で残す。
// 直近 RECENT_DAYS 日分だけを新着として取り込む。
const API = "https://www.pokemon.co.jp/api/goods/index/?limit=20&pokecen=0&page=";
const MAX_PAGES = 4;

/**
 * 「新着」として載せ続けてよい日数。**取り込みと掲載の両方がこの1つの値を使う。**
 *
 * 実測（2026-08-17）: この cutoff は取り込み側にしか効いておらず、**一度入った行は
 * 何日経っても消えなかった**。掲載中の pokemon_goods 105件は全部が過去日で、
 * 最も古いものは **52日前**・中央値 24日前。eventDate を持たない設計（下記）のため
 * 「日付未定」の顔をして今後の一覧に居座り、`isStalePlan` でも 1件も落ちていなかった
 * （0/105）。＝ミス13と同じ型（取り込み時のルールが、既に入った行に届かない）。
 */
export const POKEMON_GOODS_RECENT_DAYS = 30;

/** 「登場 2026/08/14」から登場日（暦日）を読む。読めなければ null。 */
export function parseAppearedDate(eventDateText: string | null | undefined): Date | null {
  const m = /(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(eventDateText ?? "");
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCDate() === Number(m[3]) ? d : null;
}

/**
 * まだ「新着」と言ってよいか（登場から RECENT_DAYS 日以内）。
 * **日付が読めない行は true**＝落とさない。読めないことを理由に消すと、書式が変わった日に
 * ソースが丸ごと消える（誤報より取りこぼしの方が静かで怖い）。
 */
export function isRecentPokemonGoods(
  eventDateText: string | null | undefined,
  today: Date,
  days: number = POKEMON_GOODS_RECENT_DAYS
): boolean {
  const appeared = parseAppearedDate(eventDateText);
  if (!appeared) return true;
  return today.getTime() - appeared.getTime() <= days * 86_400_000;
}

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
  // 「直近N日」の起点も日本時間の暦日から作る（ローカル時刻依存にしない）。
  const t = todayJst();
  const cutoff = new Date(t.getTime() - POKEMON_GOODS_RECENT_DAYS * 86_400_000);

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
        // 一番くじはポケモン題材でも独立ジャンル（classifyGenre・ichiban_kuji と揃える）。
        // ジャンルが割れると別ジャンルページに分かれ、ページ単位の重複解消が届かずに
        // 同じくじのカードが2枚出る（実測: ポケモンマスターズ EX 7th が #7566/#58799 で二重）。
        genre: /一番くじ/.test(r.title) ? "一番くじ" : "ポケモン",
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
