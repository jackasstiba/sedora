import * as cheerio from "cheerio";
import { ScrapedItem } from "./types";
import { fetchHtmlDetectCharset, resolveMonthDay } from "./util";
import { todayJst } from "../lib/date";

// BILLY'S ENT（ビリーズ）公式通販の LAUNCH＝**発売日カレンダー**。
//
// なぜ足したか（2026-08-18 実測）: 既存のスニーカー2ソースは
//   ・nike_snkrs … Nike公式なので Nike しか無い
//   ・snkrdunk   … 相場メディアの発売カレンダー（買える店には繋がらない）
// で、**SALOMON / New Balance / asics / CONVERSE / MIZUNO は本番0〜11件**だった。
// LAUNCH は「何が・何日に・いくらで出るか」に加えて **予約受付が今開いているか**まで
// 書いてある一次情報で、そのまま買いに行ける。
//
// 【掲載方針】url は公式通販の商品/LAUNCH ページ（一次情報）＝直リンクしてよい。

const STORE = "https://www.billys-tokyo.net";
const LAUNCH_URL = `${STORE}/shop/pages/launch.aspx`;

/** 発売日を過ぎた行を何日残すか（発売当日は「本日発売」として見せたい）。 */
const KEEP_DAYS_AFTER_RELEASE = 0;

export type BillysLaunch = {
  brand: string;
  name: string;
  price: string | null;
  month: number;
  day: number;
  preorder: boolean;
  href: string;
  imageUrl: string | null;
};

/**
 * ブランド欄の区切りをコラボ表記に直す。
 *
 * 収集元はコラボを **「A | B」** と書く（実測 2026-08-18: `CONVERSE | PURPLE THINGS`）。
 * これをそのまま商品名に繋ぐと `CONVERSE | PURPLE THINGS ALL STAR LGCY SU HI` になり、
 * **収集元の区切り記号がタイトルに残った状態**（audit `title_pipe_residue` が ERROR で捕まえる型）
 * と見分けがつかない。かといって記号を**消すと**「CONVERSE PURPLE THINGS」という
 * 1つのブランド名に読める＝存在しないブランドを名乗ることになる。
 * 意味はコラボなので「×」に替える（日本語圏でコラボを表す記号）。
 */
export function normalizeBillysBrand(brand: string): string {
  return brand
    .replace(/\s*[|｜]\s*/g, " × ")
    .replace(/\s+/g, " ")
    .trim();
}

/** LAUNCH一覧から発売予定を取り出す（純関数・selftest対象）。 */
export function parseBillysLaunch(html: string): BillysLaunch[] {
  const $ = cheerio.load(html);
  const rows: BillysLaunch[] = [];
  $(".c-launchlist__list > li").each((_, el) => {
    const li = $(el);
    const brand = normalizeBillysBrand(li.find(".c-itembox__cat").first().text());
    const name = li.find(".c-itembox__goodsname").first().text().replace(/\s+/g, " ").trim();
    if (!name) return;

    const priceText = li.find(".c-price__default").first().text().replace(/\s+/g, " ").trim();
    // 収集元に「¥018,700」のような先頭0付きの表記が実在する（実測 MIZUNO WAVE MUSTANG）。
    // 数字だけ取り出して整え直す＝収集元の打ち間違いをそのまま価格として出さない。
    const digits = priceText.match(/[¥￥]\s*([\d,]+)/)?.[1]?.replace(/,/g, "");
    const yen = digits ? Number(digits) : null;

    const dateText = li.find(".c-launchlist__date span").first().text().trim();
    const md = dateText.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (!md) return;

    const img = li.find("img").first().attr("src") ?? null;
    rows.push({
      brand,
      name,
      price: yen ? `${yen.toLocaleString()}円` : null,
      month: Number(md[1]),
      day: Number(md[2]),
      // 「予約受付中」は収集元が明示している事実。推測で足さない。
      preorder: /予約受付中/.test(priceText),
      href: li.find("a").first().attr("href") ?? "",
      imageUrl: img,
    });
  });
  return rows;
}

/** LAUNCH は靴が中心だが、アパレルも混ざる。名前で見分けてジャンル語彙に落とす。 */
export function billysGenre(name: string): string {
  if (/tシャツ|t-shirt|hoodie|パーカー|キャップ|cap|jacket|ジャケット|パンツ|ソックス|socks|バッグ|bag/i.test(name)) {
    return "その他";
  }
  return "スニーカー";
}

export async function scrapeBillys(): Promise<ScrapedItem[]> {
  const html = await fetchHtmlDetectCharset(LAUNCH_URL);
  const today = todayJst();
  const cutoff = today.getTime() - KEEP_DAYS_AFTER_RELEASE * 86_400_000;

  // **同じ商品名は1枚に畳む。日付が違っても畳む。**
  //
  // 収集元は色違い（カラーウェイ）を別々の行にするが、`.c-itembox__goodsname` には
  // 型名しか入らない（実測 2026-08-18: SALOMON XT-6 が 8/19 と 8/21 の2行、
  // SALOMON X-ALP LEATHER が同日2行、asics GEL-KINETIC FR が同一リンクで2行）。
  // 商品ページの <title> も「SALOMON XT-6」「XT-6 L49306600」で**色は書かれていない**ので、
  // 載せると **文字も価格も同じカードが2枚並ぶ**（audit dup_exact が実際にERRORで検出）。
  // 見分けられない2枚は「応募先/発売が2つある」と誤読されるだけなので、
  // 直近の発売日を残して畳む（[[Projects/sedori_radar]] 4.5 と同じ考え方）。
  const byId = new Map<string, ScrapedItem>();

  for (const row of parseBillysLaunch(html)) {
    // 年の無い「8/19」は、記事の年を推測せず基準日にいちばん近い年に解決する。
    const date = resolveMonthDay(row.month, row.day, today);
    if (date.getTime() < cutoff) continue;

    const title = [row.brand, row.name].filter(Boolean).join(" ").trim();
    const sourceId = title.replace(/\s+/g, "-").toLowerCase();
    const prev = byId.get(sourceId);
    // 同名が複数あれば「いちばん早く買える日」を残す＝行動できる方を見せる。
    if (prev?.eventDate && prev.eventDate.getTime() <= date.getTime()) continue;

    byId.set(sourceId, {
      source: "billys",
      sourceId,
      title,
      genre: billysGenre(row.name),
      subGenre: row.brand || null,
      eventType: "発売",
      eventDate: date,
      eventDateText: null,
      price: row.price,
      url: row.href.startsWith("http") ? row.href : `${STORE}${row.href}`,
      imageUrl: row.imageUrl
        ? row.imageUrl.startsWith("http")
          ? row.imageUrl
          : `${STORE}${row.imageUrl}`
        : null,
      // 「今から予約できるか」は発売日と同じくらい効く情報で、収集元が明示している。
      salesChannel: row.preorder
        ? "BILLY'S ENT 公式通販（予約受付中）"
        : "BILLY'S ENT 公式通販",
    });
  }

  return [...byId.values()];
}
