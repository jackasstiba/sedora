import { ScrapedItem } from "./types";
import { fetchHtml, parseJapaneseFullDate, sleep } from "./util";
import { classifyAggregatorGenre, stripTags } from "./aggregatorUtil";

// 転売クエスト（tenbaiquest.com）の "抽選" 記事を全カテゴリ横断で収集する。
//
// 【方針・2026-08-04 本人確定】競合アグリの抽選情報は "全部" 取り込むが、フロントには
// 収集元（転売クエストの名・記事へのリンク）を一切出さない＝「情報源にしていない体裁」。
// 購入導線は商品名での楽天検索に寄せ、Amazon等のアフィリ/トラッキングは載せない。
//
// 取得方式: 素の fetch で取れる WordPress。記事一覧（/page/N）を巡回し、
// ①「【抽選：YYYY年M月D日…まで】…」の抽選投稿（締切が未来のもの）
// ②「【YYYY年M月D日（曜）】商品名」の発売日投稿（発売日が今日以降のもの）
// を採用する。②は2026-08-15追加＝本人指摘「全然取れてない」。1-5頁の実測で
// 抽選98に対し発売日投稿が47件あり全部捨てていた（ポケカMEGA 30th等の転売向き新商品）。
// 「限定公開記事」等の商品名を持たない投稿は採用しない。

const HOME = "https://tenbaiquest.com/";
const MAX_LIST_PAGES = 5; // 開催中の抽選は新しい投稿に集中するため、直近ページで十分カバーできる。

// カテゴリ表記からのフォールバック（商品名からジャンルを推定できなかったとき）。
const CAT_GENRE: Record<string, string> = {
  フィギュア: "フィギュア",
  スニーカー: "スニーカー",
  ゲーム: "家電・ゲーム機", // 語彙は GENRE_ORDER に揃える
  音楽: "映像・音楽",
};

type Card = { slugPath: string; title: string; cat: string };

/** 一覧HTMLから記事カード（記事パス・タイトル・カテゴリ）を取り出す。 */
function parseCards(html: string): Card[] {
  const out: Card[] = [];
  // h3 の記事リンク → 直後の cat_link のカテゴリ名、をまとめて拾う（隣接マークアップ）。
  const re =
    /<h3><a href="https:\/\/tenbaiquest\.com\/([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h3>\s*<p class="cat_link">[\s\S]*?rel="category tag">([\s\S]*?)<\/a>/g;
  for (const m of html.matchAll(re)) {
    const slugPath = m[1].replace(/\/$/, "");
    const title = stripTags(m[2]);
    const cat = stripTags(m[3]);
    if (!slugPath || !title) continue;
    out.push({ slugPath, title, cat });
  }
  return out;
}

/** タイトルが抽選投稿か（「【抽選：…】…」で始まる）。 */
function isLotteryTitle(title: string): boolean {
  return /^\s*【\s*抽選/.test(title);
}

/** タイトルが発売日投稿か（「【YYYY年M月D日…】商品名」。年4桁必須＝年無しの曖昧な日付は採らない）。 */
export function isReleaseTitle(title: string): boolean {
  return /^\s*【\s*\d{4}年\s*\d{1,2}月\s*\d{1,2}日/.test(title.normalize("NFKC"));
}

/** 先頭の【抽選：…】【YYYY年…】等のブラケットを外して商品名にする。 */
export function cleanProductName(title: string): string {
  return title.replace(/^\s*【[^】]*】\s*/, "").trim();
}

function rakutenSearchUrl(name: string): string {
  return `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(name.trim())}/`;
}

export async function scrapeTenbaiQuest(): Promise<ScrapedItem[]> {
  // 「日本時間の今日」を暦日(UTC0時)で。締切が過去の抽選（＝受付終了）は載せない。
  const j = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const today = new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate()));

  const byId = new Map<string, Card>();
  for (let p = 1; p <= MAX_LIST_PAGES; p++) {
    const url = p === 1 ? HOME : `https://tenbaiquest.com/page/${p}`;
    let html: string;
    try {
      html = await fetchHtml(url);
    } catch {
      break;
    }
    const cards = parseCards(html);
    let added = 0;
    for (const c of cards) {
      if (!byId.has(c.slugPath)) {
        byId.set(c.slugPath, c);
        added++;
      }
    }
    if (added === 0) break;
    await sleep(400);
  }

  const items: ScrapedItem[] = [];
  for (const c of byId.values()) {
    const lottery = isLotteryTitle(c.title);
    const release = !lottery && isReleaseTitle(c.title);
    if (!lottery && !release) continue; // 「限定公開記事」等の商品名を持たない投稿は採らない

    const name = cleanProductName(c.title);
    if (name.length < 3) continue;
    if (/限定公開記事/.test(name)) continue;

    // 抽選＝タイトル内の締切日／発売日投稿＝発売日。どちらも過去なら載せない。
    const date = parseJapaneseFullDate(c.title.normalize("NFKC"));
    if (date && date.getTime() < today.getTime()) continue;
    if (release && !date) continue; // 発売日投稿なのに日付が読めない＝採らない

    let genre = classifyAggregatorGenre(name);
    if (genre === "その他" && CAT_GENRE[c.cat]) genre = CAT_GENRE[c.cat];

    items.push({
      source: "tenbaiquest",
      sourceId: c.slugPath, // 記事パス＝安定・一意（例 "figure/medicom_toy_30th_exhibition"）
      title: name,
      genre,
      subGenre: null,
      eventType: lottery ? "抽選" : "発売",
      eventDate: date,
      eventDateText: date ? null : "抽選 受付中",
      price: null,
      // 収集元（転売クエスト）は一切出さない。購入導線は商品名で楽天検索に寄せる。
      url: rakutenSearchUrl(name),
      imageUrl: null, // 競合ドメイン画像のホットリンクは情報源露見につながるため使わない。
      hasLottery: lottery,
    });
  }

  return items;
}
