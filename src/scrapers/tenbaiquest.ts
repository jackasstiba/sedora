import { ScrapedItem } from "./types";
import { fetchHtml, parseJapaneseFullDate, sleep } from "./util";
import { classifyAggregatorGenre, stripTags } from "./aggregatorUtil";

// 転売クエスト（tenbaiquest.com）の "抽選" 記事を全カテゴリ横断で収集する。
//
// 【方針・2026-08-04 本人確定】競合アグリの抽選情報は "全部" 取り込むが、フロントには
// 収集元（転売クエストの名・記事へのリンク）を一切出さない＝「情報源にしていない体裁」。
// 購入導線は商品名での楽天検索に寄せ、Amazon等のアフィリ/トラッキングは載せない。
//
// 取得方式: 素の fetch で取れる WordPress。記事一覧（/page/N）を巡回し、タイトルが
// 「【抽選：YYYY年M月D日…まで】…」形式の投稿だけを採用する（＝抽選ファースト）。
// 「【2026年M月D日（水）】…」のような単なる発売日投稿（抽選でない）は採用しない。

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

/** タイトルが抽選投稿か（「【抽選：…】…」で始まる）。発売日のみの投稿は false。 */
function isLotteryTitle(title: string): boolean {
  return /^\s*【\s*抽選/.test(title);
}

/** 先頭の【抽選：…】等のブラケットを外して商品名にする。 */
function cleanProductName(title: string): string {
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
    if (!isLotteryTitle(c.title)) continue; // 抽選ファースト（発売日のみの投稿は除外）
    const name = cleanProductName(c.title);
    if (name.length < 3) continue;

    // 締切＝タイトル内の「YYYY年M月D日」。過去の締切（受付終了）は載せない。
    const deadline = parseJapaneseFullDate(c.title.normalize("NFKC"));
    if (deadline && deadline.getTime() < today.getTime()) continue;

    let genre = classifyAggregatorGenre(name);
    if (genre === "その他" && CAT_GENRE[c.cat]) genre = CAT_GENRE[c.cat];

    items.push({
      source: "tenbaiquest",
      sourceId: c.slugPath, // 記事パス＝安定・一意（例 "figure/medicom_toy_30th_exhibition"）
      title: name,
      genre,
      subGenre: null,
      eventType: "抽選",
      eventDate: deadline,
      eventDateText: deadline ? null : "抽選 受付中",
      price: null,
      // 収集元（転売クエスト）は一切出さない。購入導線は商品名で楽天検索に寄せる。
      url: rakutenSearchUrl(name),
      imageUrl: null, // 競合ドメイン画像のホットリンクは情報源露見につながるため使わない。
      hasLottery: true,
    });
  }

  return items;
}
