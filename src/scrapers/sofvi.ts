import { ScrapedItem } from "./types";
import { todayJst } from "../lib/date";
import { fetchHtml, sleep } from "./util";
import { stripTags } from "./aggregatorUtil";
import { rakutenSearchRawUrl } from "../lib/outbound";

// sofvi.tokyo（メディコム・トイ運営のソフビ総合情報サイト）。
// 実測（2026-08-15）: トップの新着一覧が
//   <li class="date">2026-08-15</li> … <h4 class="title"><a href="URL">見出し</a></h4>
// で並び、見出しに商品名（「」内）とブランド（［］内）、抽選記事は「抽選受付締切は16日まで！」
// のような**日だけの締切**が入る（月は記事日付から補う）。
// ソフビ・アートトイジャンル（現在ほぼ空）の供給源。
//
// 【掲載基準】ニュース見出しをそのまま商品名にしない（実況見出しの再来になる）。
// ［ブランド］と「商品名」を組み立てられて、かつ**締切か発売日が立てられる記事だけ**載せる。
// 発売済みレポート（「出現！」「現る！」等・日付なし）は載せない。

const HOME = "https://sofvi.tokyo/";

const CARD_RE =
  /<li class="date">(\d{4})-(\d{2})-(\d{2})<\/li>[\s\S]{0,400}?<h4 class="title"><a href="(https:\/\/sofvi\.tokyo\/[^"]+)">([\s\S]*?)<\/a><\/h4>/g;

export type SofviCard = { posted: Date; url: string; headline: string };

export function parseSofviCards(html: string): SofviCard[] {
  const out: SofviCard[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(CARD_RE)) {
    const url = m[4];
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({
      posted: new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))),
      url,
      headline: stripTags(m[5]),
    });
  }
  return out;
}

/** 見出しから「［ブランド］＋「商品名」」を組み立てる。作れなければ null（載せない）。 */
export function sofviProductName(headline: string): string | null {
  const brands = [...headline.matchAll(/［([^］]{2,40})］/g)].map((m) => m[1]);
  const quoted = [...headline.matchAll(/「([^」]{2,60})」/g)].map((m) => m[1]);
  if (quoted.length === 0) return null;
  const product = quoted[quoted.length - 1]; // 商品名は見出し末尾側の「」に来る（実測）
  if (product.length < 3) return null;
  const brand = brands[brands.length - 1];
  // 商品名がブランド名で始まる（「［MAT］…「MAT ブロッケン(2期)」」）なら重ねない。
  return brand && !product.startsWith(brand) ? `${brand} ${product}` : product;
}

/** 見出しから期日を立てる。①「締切は16日まで」＝記事日付の月で補完（過ぎていれば翌月）
 *  ②「M月D日発売/受注開始」型。どちらも無ければ null（載せない）。 */
export function sofviEventInfo(
  headline: string,
  posted: Date
): { eventType: string; date: Date } | null {
  const norm = headline.normalize("NFKC");
  // 見出しの締切の書き方は揺れる（実測 2026-09-12: 「締切は16日まで」「受注締切は明日2日まで」
  // 「明日10日受付締切」「受付締切は本日14日中」）。「締切」の前後どちらに日が来てもよい。
  const dayOnly =
    norm.match(/(?:締切|締め切り)は?(?:本日|明日|明後日)?(\d{1,2})日/) ??
    norm.match(/(?:本日|明日|明後日)?(\d{1,2})日(?:受付|受注|応募)?(?:締切|締め切り)/);
  if (dayOnly) {
    const day = Number(dayOnly[1]);
    let d = new Date(Date.UTC(posted.getUTCFullYear(), posted.getUTCMonth(), day));
    if (d.getTime() < posted.getTime()) d = new Date(Date.UTC(posted.getUTCFullYear(), posted.getUTCMonth() + 1, day));
    return { eventType: "抽選", date: d };
  }
  const md = norm.match(/(\d{1,2})月(\d{1,2})日[^、。]{0,10}?(発売|受注|予約|抽選|受付)/);
  if (md) {
    // 年は記事日付基準（未来寄り: 記事月より2ヶ月以上前の月は翌年）
    let y = posted.getUTCFullYear();
    if (Number(md[1]) < posted.getUTCMonth() + 1 - 2) y += 1;
    return {
      eventType: md[3] === "発売" ? "発売" : md[3] === "抽選" ? "抽選" : "予約",
      date: new Date(Date.UTC(y, Number(md[1]) - 1, Number(md[2]))),
    };
  }
  return null;
}

/**
 * 記事本文から受付締切を読む（純関数・selftest対象）。
 *
 * 2026-09-12 実測: 見出しに締切が入る記事は30本中2本しかなく、残りは本文に
 * 「2026年9月13日10時〜2026年9月17日23時59分まで」「2026年9月18日17時まで 少年リック にて受注受付」
 * の形で書いてある。見出しだけ読む設計では**9/4から0件が続いた**（受注中の商品は実在した）。
 * 年月日が揃って「まで」で閉じる**最後の**日付だけを締切として採る（範囲の始点を締切にしない）。
 * 過去の日付（記事より前）は締切ではない（開催報告等）ので捨てる。
 */
export function sofviDeadlineFromArticle(
  html: string,
  posted: Date
): { date: Date; text: string; lottery: boolean; storeUrl: string | null } | null {
  const rawBody = html.slice(Math.max(0, html.indexOf("</head>")));
  const body = stripTags(rawBody).normalize("NFKC").replace(/\s+/g, " ");
  const re =
    /(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日(?:\s*\(?[月火水木金土日祝]\)?)?(?:\s*\d{1,2}時(?:\s*\d{1,2}分)?)?\s*(?:まで|迄)/g;
  for (const m of body.matchAll(re)) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    const date = new Date(Date.UTC(y, mo - 1, d));
    if (date.getTime() < posted.getTime()) continue;
    // 本文で最初に出る締切＝その記事の商品の締切。抽選か受注かは**締切の周辺の文**で決める
    // （ページ全体で見ると、ナビに並ぶ他記事の「抽選販売！」を拾って全部が抽選になる）。
    // 締切を含む**1文**（。！で区切る）だけを見る。
    const at = m.index ?? 0;
    const before = body.slice(Math.max(0, at - 200), at);
    const after = body.slice(at, at + 200);
    const sentence = before.slice(before.search(/[^。！!]*$/)) + after.split(/[。！!]/)[0];
    return { date, text: m[0].trim(), lottery: /抽選/.test(sentence), storeUrl: storeLinkNear(rawBody, m[0]) };
  }
  return null;
}

/**
 * 締切の文と同じ段落にある**販売店のリンク**（「2026年9月18日17時まで 少年リック にて受注受付」の
 * 少年リック＝ https://jp.ric-toy.com/200647r.html）。収集元（sofvi.tokyo）は非公開のまま、
 * 買える場所だけを officialUrl として出す＝collabo_cafe の officialUrl と同じ扱い。
 * SNS・収集元自身・共有ボタンのリンクは店ではないので除く。無ければ null（楽天検索のまま）。
 */
export function storeLinkNear(rawHtml: string, deadlineText: string): string | null {
  const key = deadlineText.replace(/\s+/g, "").slice(0, 12);
  for (const p of rawHtml.split(/<\/p>|<br\s*\/?>/i)) {
    if (!stripTags(p).normalize("NFKC").replace(/\s+/g, "").includes(key)) continue;
    for (const m of p.matchAll(/<a\s[^>]*href="(https?:\/\/[^"]+)"/gi)) {
      const u = m[1];
      if (/sofvi\.tokyo|twitter\.com|x\.com|instagram\.com|facebook\.com|line\.me|youtube\.com/i.test(u)) continue;
      // 応募フォーム（Google フォーム等）は店のページではない。画面のラベルは「公式ページを見る」
      // なので、店の商品ページだけを約束する（フォームを出すなら別ラベルが要る＝未実装）。
      if (/docs\.google\.com|forms\.gle/i.test(u)) continue;
      return u;
    }
  }
  return null;
}

/** 本文を開いて締切を探す記事の上限（収集元への負荷の保険。新着一覧は30本）。 */
const MAX_ARTICLE_FETCH = 30;

export async function scrapeSofvi(): Promise<ScrapedItem[]> {
  const html = await fetchHtml(HOME);
  const today = todayJst();
  const cutoff = today.getTime() - 3 * 86_400_000;

  const items: ScrapedItem[] = [];
  let opened = 0;
  for (const c of parseSofviCards(html)) {
    const name = sofviProductName(c.headline);
    if (!name) continue;
    let info = sofviEventInfo(c.headline, c.posted);
    let dateText: string | null = null;
    let storeUrl: string | null = null;
    if (!info && opened < MAX_ARTICLE_FETCH) {
      // 見出しに期日が無い＝本文を開いて「YYYY年M月D日…まで」を探す（上のコメント）。
      opened++;
      try {
        const article = await fetchHtml(c.url);
        const dl = sofviDeadlineFromArticle(article, c.posted);
        if (dl) {
          info = { eventType: dl.lottery || /抽選/.test(c.headline) ? "抽選" : "予約", date: dl.date };
          dateText = dl.text;
          storeUrl = dl.storeUrl;
        }
      } catch {
        // 記事が開けない＝その記事は載せない（見出しだけで日付を作らない）
      }
      await sleep(300);
    }
    if (!info || info.date.getTime() < cutoff) continue;

    const slug = c.url.replace(/\/$/, "").split("/").pop() ?? c.url;
    items.push({
      source: "sofvi",
      sourceId: slug,
      title: name,
      genre: "ソフビ・アートトイ",
      subGenre: null,
      eventType: info.eventType,
      eventDate: info.date,
      eventDateText: dateText,
      price: null,
      // 収集元の記事リンクはフロントに出さない方針＝導線は商品名の楽天検索。
      // **保存するのは素の検索URL。** アフィリ化は画面に出す瞬間だけ（outbound.ts の注意書き）。
      url: rakutenSearchRawUrl(name),
      imageUrl: null, // sofvi.tokyo ホストの画像を直リンクすると収集元が露見するため使わない
      // 締切の文にあった販売店のページ（storeLinkNear）。収集元は出さず、買える場所だけを出す。
      officialUrl: storeUrl,
      hasLottery: info.eventType === "抽選",
      highlights:
        info.eventType === "抽選"
          ? `抽選受付 〜${info.date.getUTCMonth() + 1}/${info.date.getUTCDate()}`
          : `受注受付 〜${info.date.getUTCMonth() + 1}/${info.date.getUTCDate()}`,
    });
  }
  return items;
}
