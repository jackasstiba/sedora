import * as cheerio from "cheerio";
import { ScrapedItem } from "./types";
import { fetchHtml, parseJapaneseFullDate } from "./util";

/**
 * 一覧ページ。**個別ページがまだ無い行の置き場**としても使う（`url` は必須列なので null にできない）。
 *
 * 実測 2026-08-19: 392件中3件が詳細リンクを持たない（収集元側にまだ個別ページが無い商品）。
 * 商品としては本物（名前・入荷月・写真がある）ので落とさない。ただし**商品のページではない**ので、
 * 「複数商品が同じリンク先を指している」の検査からは外す（audit が実物の粗と区別できるように、
 * 判定は figislandListPlaceholder ひとつに寄せる）。
 * ⚠️ この置き場が成立する前提は「figisland の item.url を画面に出さない」こと
 * （`isOfficialUrl("figisland") === false`）。前提が崩れたら audit:selftest が落ちる。
 */
export const LIST_URL = "https://figisland.net/prizes-schedule/";

/** その行の url が「個別ページが無いための置き場」か。 */
export function figislandListPlaceholder(source: string, url: string): boolean {
  return source === "figisland" && url === LIST_URL;
}

/**
 * 見出しの文言（"2026年09月18日登場予定"）→ 暦日。
 *
 * 日まで書かれているものだけを日付にする。「2026年09月02週登場予定」「2026年08月下旬登場予定」
 * 「2026年09月登場予定」は**日が公表されていない**ので日付を作らない（null）＝
 * 月精度の情報から特定日を合成しない（date_fabricated_precision と同じ約束）。
 */
export function parseFigislandHeadingDate(headingText: string): Date | null {
  return parseJapaneseFullDate(headingText);
}

export async function scrapeFigisland(): Promise<ScrapedItem[]> {
  const html = await fetchHtml(LIST_URL);
  const $ = cheerio.load(html);
  const items: ScrapedItem[] = [];

  $("div.entry-content.cf[itemprop='mainEntityOfPage'] > div.yoteiall").each((_, groupEl) => {
    const group = $(groupEl);
    const heading = group.find("> h2[id]").first();
    const headingText = heading.text().trim();
    // 日付は **見出しの文言** から作る。id 属性から作ってはいけない。
    //
    // 実測 2026-08-19: 収集元の9月分は `id="20260904"` が **3つの見出しで使い回されていた**
    // （9月04日／9月11日／9月18日）。id を信じていたため 21件が最大2週間早い日付で本番に出ていた
    // （/items/95479 の `<title>` が「…の登場予定｜9/4(金)」＝正しくは 9/18）。
    // 読者に見えているのは見出しの文言のほうで、id は収集元の内部都合（アンカー）に過ぎない。
    // ワンピース公式の `datetime="2026-10-01"`（表示は「2026.10」）と同じ型＝ミス15。
    const eventDate = parseFigislandHeadingDate(headingText);

    group.find("> div.yotei").each((_, itemEl) => {
      const el = $(itemEl);
      const title = el.find("> h4").first().text().trim();
      if (!title) return;

      const detailLink = el.find("a.btn.btn-red").first().attr("href") ?? "";
      const idMatch = detailLink.match(/\/fi(\d+)_s\//);
      const sourceId = idMatch ? `fi${idMatch[1]}` : detailLink || title;

      const imageUrl = el.find("p").first().find("img").first().attr("src") ?? null;

      // 商品ではなく「新作プライズ入荷予定表 未定情報」等の見出し／プレースホルダ行を除外。
      // 本物の商品は必ず詳細リンク(fiXXXX)か画像を持つので、両方欠けている行は捨てる
      // （薄いSEOページ・空カードの混入を防ぐ）。
      if (!idMatch && !imageUrl) return;
      // ※ 上の条件だけでは足りなかった。この見出し行は**画像を持っている**ため素通りし、
      //   DBから消しても次のスクレイプで新しいIDで復活していた（実測 #1 → #34535）。
      //   ページ自身の見出し語（入荷予定表）は商品名には現れない（全2566件中この行だけ）ので、
      //   個別ページを持たない＋見出し語を含む、の両方を満たす行を落とす。
      if (!idMatch && /入荷予定表/.test(title)) return;

      items.push({
        source: "figisland",
        sourceId,
        title,
        genre: "フィギュア",
        subGenre: "プライズ",
        eventType: "登場予定",
        eventDate,
        eventDateText: headingText || null,
        price: null,
        url: detailLink || LIST_URL,
        imageUrl,
      });
    });
  });

  return items;
}
