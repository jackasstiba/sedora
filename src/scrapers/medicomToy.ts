import * as cheerio from "cheerio";
import { ScrapedItem } from "./types";
import { fetchHtml, monthPlanDate, sleep } from "./util";
import { calendarDate, todayJst } from "../lib/date";

// メディコム・トイ公式（BE@RBRICK / ソフビ）＝**受注開始（＝予約できる）の一次情報**。
//
// なぜ足したか（2026-08-18 実測）: 本番3512件に「BE@RBRICK」「ベアブリック」「メディコム」が
// **3語とも0件**。ジャンル「ソフビ・アートトイ」に至っては全体で3件しかなく、実質空だった。
// ベアブリックは1体1〜3万円台の受注品が二次で数倍になる定番なので、穴としては相当大きい。
// （同じ層の POP MART / LABUBU は Cloudflare + クライアント描画で本文が取れず取得不能と
//   実証済み＝[[Projects/sedori_radar]]。取れる方から埋める。）
//
// 取得方式: `/top/` に「◯◯の受注を開始しました。」の告知が並び、各詳細 `/list/<id>.html` の
// `#p_descrip` に「2026年10月発売・発送予定 / 商品名 / 頒布価格￥17,380（税込）」がある。
//
// 【掲載方針】url は公式の商品ページ（一次情報）＝直リンクしてよい。

const HOME = "https://www.medicomtoy.co.jp";
const LIST_URL = `${HOME}/top/`;

/**
 * 詳細を取りに行く件数の上限。`/top/` は300件超を1枚に並べており、全部の詳細を毎回
 * 取ると巡回時間が跳ねる。並びは新しい告知が先頭なので、先頭から一定数だけ見る。
 * **取りこぼしても静かに0件になるだけ**なので、件数が張り付いたら見直すこと。
 */
const MAX_DETAILS = 250;

export type MedicomPost = { id: string; url: string; headline: string };

/**
 * 商品一覧から商品ページを取り出す（純関数・selftest対象）。
 *
 * `/top/` には2種類の入口が同居する:
 *   ・What's New の告知リンク … アンカーのテキストが「◯◯の受注を開始しました。」
 *   ・商品タイル `div.productdata` … アンカーは画像だけで、商品名は `img[alt]` にある
 * 最初はテキストのあるものだけ拾っていたが、それは **308件中8件**（＝告知欄だけ）で、
 * 商品一覧そのものを丸ごと見落としていた。**アンカーのテキストが空＝商品ではない、
 * という思い込みが取りこぼしの原因**なので、alt も名前として扱う。
 */
export function parseMedicomList(html: string): MedicomPost[] {
  const $ = cheerio.load(html);
  const seen = new Map<string, MedicomPost>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const m = href.match(/\/list\/(\d+)\.html/);
    if (!m) return;
    const text = $(el).text().replace(/\s+/g, " ").trim();
    const alt = $(el).find("img").first().attr("alt")?.replace(/\s+/g, " ").trim() ?? "";
    const headline = text || alt;
    if (!headline) return;
    if (seen.has(m[1])) return;
    seen.set(m[1], { id: m[1], url: `${HOME}/list/${m[1]}.html`, headline });
  });
  return [...seen.values()];
}

export type MedicomDetail = {
  name: string | null;
  price: string | null;
  planText: string | null; // 「2026年10月発売・発送予定」
  year: number | null;
  month: number | null;
  day: number | null; // 日まで書いてある告知だけ入る（無ければ月精度）
  imageUrl: string | null;
  storeUrl: string | null;
};

/** 商品ページ本文から商品名・頒布価格・発売予定を取り出す（純関数・selftest対象）。 */
export function parseMedicomDetail(html: string): MedicomDetail {
  const $ = cheerio.load(html);
  const descrip = $("#p_descrip").first();
  // <br> 区切りの平文。行に割ってから読む（1行目=発売予定、次に商品名、以降に頒布価格）。
  const lines =
    descrip
      .html()
      ?.split(/<br\s*\/?>/i)
      .map((s) => cheerio.load(`<div>${s}</div>`)("div").text().replace(/\s+/g, " ").trim())
      .filter(Boolean) ?? [];

  const planLine = lines.find((l) => /\d{4}年\s*\d{1,2}月.*(?:発売|発送)/.test(l)) ?? null;
  const ym = planLine?.match(/(\d{4})年\s*(\d{1,2})月/);
  // 日まで書いてある告知がある（「2026年7月25日発売予定」）。**日を読まずに月初を入れると
  // カードに 7/1 という実在しない発売日が出る**（[[System/mistakes]] ミス15と同型）ので、
  // 日精度と月精度をここで分ける。
  const dayMatch = planLine?.match(/\d{4}年\s*\d{1,2}月\s*(\d{1,2})\s*日/);

  // 商品名は「発売予定」行の次から。**1行とは限らない**（実測: BAPE コラボは
  // 「MCT 30th ANNIV. BAPE(R) CAMO」/「REVERSIBLE BE@R SHARK FULL ZIP HOODIE」の2行で、
  // 先頭行だけ採ると **商品名が途中で切れたカード**になる）。頒布価格・箇条書き（●）・
  // 空行のどれかに当たるまでを名前として繋ぐ。
  const planIdx = planLine ? lines.indexOf(planLine) : -1;
  const nameParts: string[] = [];
  if (planIdx >= 0) {
    for (const line of lines.slice(planIdx + 1)) {
      if (/^(?:頒布価格|価格|●|※|\(C\)|©)/i.test(line)) break;
      if (/^\d{4}年/.test(line)) break; // 次の日付告知＝名前は終わっている
      nameParts.push(line);
      if (nameParts.length >= 3) break; // 説明文まで飲み込まないための上限
    }
  }
  const name = nameParts.join(" ").trim();

  // 「頒布価格各￥36,300（税込）」＝複数サイズ共通価格の表記が実在する。「各」を挟んでも読む。
  const price = descrip.text().match(/(?:頒布価格|価格)\s*各?\s*[￥¥]\s*([\d,]+)/)?.[1] ?? null;

  const img = $("#p_imageview").first().attr("src") ?? null;
  const storeUrl = $("#p_buy a.p_buylink").first().attr("href") ?? null;

  return {
    name: name || null,
    price: price ? `${price}円` : null,
    planText: planLine,
    year: ym ? Number(ym[1]) : null,
    month: ym ? Number(ym[2]) : null,
    day: dayMatch ? Number(dayMatch[1]) : null,
    imageUrl: img ? (img.startsWith("http") ? img : `${HOME}${img.replace(/^\/\.\//, "/")}`) : null,
    storeUrl,
  };
}

export function medicomGenre(name: string): string {
  if (/BE@RBRICK|ベアブリック/i.test(name)) return "ソフビ・アートトイ";
  if (/ソフビ|VINYL|vinyl/i.test(name)) return "ソフビ・アートトイ";
  if (/フィギュア|figure|RAH|MAFEX/i.test(name)) return "フィギュア";
  return "ソフビ・アートトイ";
}

export async function scrapeMedicomToy(): Promise<ScrapedItem[]> {
  const html = await fetchHtml(LIST_URL);
  const posts = parseMedicomList(html).slice(0, MAX_DETAILS);

  const today = todayJst();
  const items: ScrapedItem[] = [];

  for (const post of posts) {
    let detailHtml: string;
    try {
      detailHtml = await fetchHtml(post.url);
    } catch {
      continue;
    }
    await sleep(300);
    const d = parseMedicomDetail(detailHtml);
    if (!d.name || !d.year || !d.month) continue; // 商品名か発売予定が読めない＝載せない

    // 日まで書いてあればその日。書いていなければ月精度＝monthPlanDate に任せる
    // （当月なら null＝日付未定にして、月初という過去の日で消えないようにする）。
    // **書いていない日を作らない**（ミス15）。
    const eventDate = d.day
      ? calendarDate(d.year, d.month, d.day)
      : monthPlanDate(d.year, d.month, today);
    // 過ぎた受注は載せ続けない。日精度なら当日まで、月精度ならその月いっぱい残す
    // （月精度の行を月初で切ると、まだ受注中の「今月発売」が初日に消える）。
    const expiry = d.day
      ? calendarDate(d.year, d.month, d.day).getTime()
      : calendarDate(d.year, d.month + 1, 1).getTime() - 1;
    if (expiry < today.getTime()) continue;

    items.push({
      source: "medicom_toy",
      sourceId: post.id,
      title: d.name,
      genre: medicomGenre(d.name),
      subGenre: null,
      // 収集元が「受注を開始しました」と言っている＝いま予約できる。
      eventType: "予約",
      eventDate,
      eventDateText: d.planText,
      price: d.price,
      url: post.url,
      imageUrl: d.imageUrl,
      // 実際に買える場所（公式オンラインストア）が本文にある時だけ渡す。
      officialUrl: d.storeUrl,
    });
  }

  return items;
}
