import * as cheerio from "cheerio";
import { ScrapedItem } from "./types";
import { fetchHtml, sleep } from "./util";
import { calendarDate, nowInstant, todayJst } from "../lib/date";

// ミタスニーカーズの抽選受付サイト（draw.mita-sneakers.co.jp）＝**一次情報の抽選告知**。
//
// なぜ足したか（2026-08-18 実測）: 本番3512件をキーワードで数えたところ、
// スニーカーは NIKE 75件 / ジョーダン 12件に対し、**アディダス・ニューバランス・アシックス・
// オニツカ・YEEZY が全部 0件**だった。既存の2ソースが構造的にそこを見ていない:
//   ・nike_snkrs … Nike公式なので Nike しか無い
//   ・snkrdunk   … 発売カレンダー（相場メディア）で、応募期間・締切までは持たない
// つまり「NIKE以外の抽選」は収集元そのものが存在しなかった（[[System/rules]] 観点D）。
//
// このサイトは1記事＝1抽選で、**品番・定価・サイズ展開・応募期間・当選連絡日**が
// 本文に揃っている。せどり視点で決定的なのは「いつまでに応募するか」＝応募期間の締切。
//
// 【掲載方針】url は記事＝抽選の公式告知ページそのもの（一次情報）なので直リンクしてよい。
// アグリゲーターではないため、収集元非公開の原則（[[収集元の扱い方]]）の対象外
// ＝「公式ページで見る」導線に載せる（outbound.ts の OFFICIAL_URL_SOURCES に登録済み）。

const HOME = "https://draw.mita-sneakers.co.jp/";

/**
 * 一覧を何ページ辿るかの安全弁。**終端の判定は「新規0件」**（下の collectPosts）で、
 * ここはループ暴走を止めるためだけの数字。
 * 固定ページ数を「実測◯ページだから」で置くと収集元に追い越されて静かに取りこぼす
 * （nyuka_now が 2026-08-18 に実際にそれで53%を落としていた）。
 */
const MAX_PAGES = 30;

/** 応募が締め切られた抽選を載せ続けないための猶予（締切当日は載せる）。 */
const KEEP_DAYS_AFTER_DEADLINE = 0;

/**
 * 記事が古すぎる＝応募はとっくに終わっている。詳細を取りに行かない足切り。
 * 応募期間は告知から数日で締まるので、30日あれば受付中を取りこぼさない。
 */
const MAX_POST_AGE_DAYS = 30;

export type MitaDrawPost = { slug: string; title: string; url: string; postedAt: Date | null };

/** 一覧HTMLから記事を取り出す（純関数・selftest対象）。 */
export function parseMitaDrawList(html: string): MitaDrawPost[] {
  const $ = cheerio.load(html);
  const posts: MitaDrawPost[] = [];
  $("article").each((_, el) => {
    const a = $(el).find(".entry-title a, h2 a").first();
    const href = a.attr("href");
    const title = a.text().replace(/\s+/g, " ").trim();
    if (!href || !title) return;
    const slug = href.replace(/\/+$/, "").split("/").pop();
    if (!slug) return;
    const dt = $(el).find("time[datetime]").first().attr("datetime");
    posts.push({ slug, title, url: href, postedAt: dt ? new Date(dt) : null });
  });
  return posts;
}

export type MitaDrawDetail = {
  price: string | null;
  deadline: Date | null;
  periodText: string | null;
  imageUrl: string | null;
  inStore: boolean;
};

/**
 * 記事本文から応募期間・定価・画像を取り出す（純関数・selftest対象）。
 *
 * 応募期間は必ず**絶対表記**（`2026年8月15日(土)0:00am～2026年8月18日(火)19:00pm`）で
 * 書かれているので、相対日付（「本日まで」等）を保存してしまう事故は起きない
 * （[[System/rules]] hasFrozenRelativeDate の型）。
 */
export function parseMitaDrawDetail(html: string): MitaDrawDetail {
  const $ = cheerio.load(html);
  const content = $(".entry-content").first();
  const text = content.text().replace(/\s+/g, " ");

  // 「抽選応募期間 2026年8月15日(土)0:00am～2026年8月18日(火)19:00pm」
  const period = text.match(
    /抽選応募期間\s*(\d{4})年(\d{1,2})月(\d{1,2})日\s*(?:\([^)]*\))?\s*([0-9:]+\s*[apAP]?\.?[mM]?\.?)?\s*[～~〜]\s*(\d{4})年(\d{1,2})月(\d{1,2})日\s*(?:\([^)]*\))?\s*([0-9:]+\s*[apAP]?\.?[mM]?\.?)?/
  );
  let deadline: Date | null = null;
  let periodText: string | null = null;
  if (period) {
    deadline = calendarDate(Number(period[5]), Number(period[6]), Number(period[7]));
    periodText = `抽選応募期間 ${period[1]}年${period[2]}月${period[3]}日${
      period[4] ? " " + period[4].trim() : ""
    }〜${period[5]}年${period[6]}月${period[7]}日${period[8] ? " " + period[8].trim() : ""}`;
  }

  // 定価は「￥13,200(税込)」。同じ品番違いが複数並ぶが値段は同じなので先頭を採る。
  const price = text.match(/[￥¥]\s*([\d,]+)\s*\(税込\)/)?.[1] ?? null;

  const imageUrl =
    content
      .find("img")
      .map((_, e) => $(e).attr("src") ?? $(e).attr("data-src") ?? "")
      .get()
      .find((s) => /wp-content\/uploads/.test(s)) ?? null;

  return {
    price: price ? `${price}円` : null,
    deadline,
    periodText,
    imageUrl: imageUrl || null,
    // 「来店抽選受付」＝店頭に行かないと応募できない。WEB抽選と同じ顔で並べると
    // 応募できない人に「応募できる」と約束してしまう（[[UIラベルは裏取り済みのみ約束]]）。
    inStore: /来店抽選|店頭抽選受付/.test(text),
  };
}

async function collectPosts(oldestMs: number): Promise<MitaDrawPost[]> {
  const byslug = new Map<string, MitaDrawPost>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = page === 1 ? HOME : `${HOME}page/${page}/`;
    let html: string;
    try {
      html = await fetchHtml(url);
    } catch {
      break; // 終端（404）
    }
    const posts = parseMitaDrawList(html);
    const before = byslug.size;
    for (const p of posts) if (!byslug.has(p.slug)) byslug.set(p.slug, p);
    if (byslug.size === before) break; // 新規が出なくなった＝終端

    // 記事は新しい順に並ぶので、ページの最後が足切りより古くなったらそれ以降は全部古い。
    // ここで止めないと、受付中が1件しかない日でも一覧を最後まで（実測30ページ）舐める。
    const last = posts[posts.length - 1]?.postedAt;
    if (last && last.getTime() < oldestMs) break;
    await sleep(400);
  }
  return [...byslug.values()];
}

export async function scrapeMitaDraw(): Promise<ScrapedItem[]> {
  const today = todayJst();
  const cutoff = today.getTime() - KEEP_DAYS_AFTER_DEADLINE * 86_400_000;
  const oldest = nowInstant().getTime() - MAX_POST_AGE_DAYS * 86_400_000;

  const posts = (await collectPosts(oldest)).filter(
    (p) => !p.postedAt || p.postedAt.getTime() >= oldest
  );

  const items: ScrapedItem[] = [];
  for (const post of posts) {
    let html: string;
    try {
      html = await fetchHtml(post.url);
    } catch {
      continue;
    }
    await sleep(400);
    const detail = parseMitaDrawDetail(html);

    // 応募期間が読めなかった＝「いつまでに応募すればいいか」を約束できない。
    // 締切の無い抽選カードは、見た人が間に合うかどうか判断できないので載せない。
    if (!detail.deadline) continue;
    if (detail.deadline.getTime() < cutoff) continue; // 受付終了

    // 記事タイトルにはスマートクォートが混ざる（“VANILLA”）。表示上は無害なので残す。
    const title = post.title.replace(/\s+/g, " ").trim();

    items.push({
      source: "mita_draw",
      sourceId: post.slug,
      title,
      genre: "スニーカー",
      subGenre: null,
      eventType: "抽選",
      eventDate: detail.deadline,
      eventDateText: detail.periodText,
      price: detail.price,
      url: post.url,
      imageUrl: detail.imageUrl,
      // 応募方法は「実体で確認できた事実」だけ書く（本文の文言そのまま由来）。
      salesChannel: detail.inStore ? "店頭（来店抽選受付）" : "WEB抽選（オンライン応募）",
    });
  }
  return items;
}
