import { ScrapedItem } from "./types";
import { todayJst } from "../lib/date";
import { parseJapaneseFullDate } from "./util";
import { crawlPages } from "./crawl";
import { classifyAggregatorGenre, stripTags } from "./aggregatorUtil";
import { rakutenSearchRawUrl } from "../lib/outbound";

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
/**
 * 安全弁（終端は下の `pageIsAllOld`＝暦で決める）。
 *
 * 2026-08-18 まではここが「5ページ。開催中の抽選は新しい投稿に集中するため直近ページで
 * 十分カバーできる」という**推測**だった。実測すると1ページ31件のうち**新規は8〜10件**
 * （固定表示の記事が毎ページ混ざる）で、5ページ＝実質57件・7月中旬まで。つまり窓の広さは
 * 書いてある数字から読めず、投稿ペースが上がれば静かに追い越される
 * （nyuka_now・channeltono が同じ日に実際にそうなっていた＝[[System/rules]] 観点D）。
 */
const MAX_LIST_PAGES = 20;

/**
 * 何日前の投稿まで遡るか。掲載条件は「締切/発売日が未来」なので、それより古い投稿は
 * 取り込んでも全部落ちる。45日あれば、応募開始が先の抽選（実測で最長1ヶ月先）まで届く。
 */
const LOOKBACK_DAYS = 45;

/**
 * 足切り。**このページの日付付き記事が1件以上あり、その全部が古い**なら以降は見ない。
 *
 * 末尾1件で決めない理由（実測 2026-08-18）: この一覧は固定表示(sticky)の記事が毎ページ
 * 混ざるので**厳密な新しい順ではない**。末尾だけを見ると、たまたま古い記事が最後に来た
 * ページで巡回が止まる＝取りこぼしが静かに起きる。日付が読めない記事は判定に使わない
 * （読めないことを理由に止めない）。
 */
function pageIsAllOld(cutoffMs: number): (cards: Card[]) => boolean {
  return (cards) => {
    const dates = cards
      .map((c) => parseJapaneseFullDate(c.title.normalize("NFKC")))
      .filter((d): d is Date => !!d);
    return dates.length > 0 && dates.every((d) => d.getTime() < cutoffMs);
  };
}

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

export async function scrapeTenbaiQuest(): Promise<ScrapedItem[]> {
  // 「日本時間の今日」を暦日(UTC0時)で。締切が過去の抽選（＝受付終了）は載せない。
  const today = todayJst();

  const cards = await crawlPages<Card>({
    label: "tenbaiquest",
    urlOf: (p) => (p === 1 ? HOME : `https://tenbaiquest.com/page/${p}`),
    parse: parseCards,
    keyOf: (c) => c.slugPath,
    isPageOld: pageIsAllOld(today.getTime() - LOOKBACK_DAYS * 86_400_000),
    maxPages: MAX_LIST_PAGES,
  });

  const items: ScrapedItem[] = [];
  for (const c of cards) {
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
      // **保存するのは素の検索URL。** アフィリ化は画面に出す瞬間だけ（outbound.ts の注意書き）。
      url: rakutenSearchRawUrl(name),
      imageUrl: null, // 競合ドメイン画像のホットリンクは情報源露見につながるため使わない。
      hasLottery: lottery,
    });
  }

  return items;
}
