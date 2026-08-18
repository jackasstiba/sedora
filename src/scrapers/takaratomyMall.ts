import * as cheerio from "cheerio";
import { ScrapedItem } from "./types";
import { fetchHtmlDetectCharset, sleep } from "./util";
import { calendarDate, todayJst } from "../lib/date";

// タカラトミーモール（公式通販）＝**トミカ/プラレール/リカちゃん/ベイブレードの一次情報**。
//
// なぜ足したか（2026-08-18 実測）: 本番3512件に「トミカ」「プラレール」「リカちゃん」が
// **3語とも0件**だった。既存21ソースはフィギュア/トレカ/プラモ/スニーカーに寄っていて、
// 玩具メーカーの限定・抽選を見ている収集元が1つも無い。モールの「オリジナル商品」は
// **ここでしか買えない＝定価で買えれば二次流通と差が出る**典型なので、穴としては大きい。
//
// 取得方式: Shift_JIS の素のHTML（fetchHtmlDetectCharset が必須。res.text() で読むと
// 商品名が全部化けたまま件数だけ正常に見える）。1商品＝1アンカーに名前・価格・ラベル・
// 発売日・購入ボタンが揃っている。
//
// 【掲載方針】url は公式ストアの商品ページ（一次情報）＝直リンクしてよい。

const STORE = "https://takaratomymall.jp";

/**
 * 巡回する一覧。**「新着」だけを見ない**のがポイントで、転売視点の本命は
 * `eOriginal`（モール限定＝他所で買えない）と `eRestock`（再入荷＝買い直せる機会）。
 */
const LISTS: { path: string; label: string }[] = [
  { path: "/shop/newarrival/newarrival.aspx/", label: "新着" },
  { path: "/shop/e/eOriginal/", label: "オリジナル" },
  { path: "/shop/e/eRestock/", label: "再入荷" },
];

export type TakaraTomyCard = {
  goodsId: string;
  name: string;
  price: string | null;
  labels: string[]; // NEW / 予約 / 再入荷 …
  isOriginal: boolean; // モール限定（オリジナル商品）
  releaseText: string | null; // 「2026年11月21日」「2026年9月中旬」
  action: string | null; // 予約する / 抽選に応募する / 入荷案内申込 …
  imageUrl: string | null;
};

/** 一覧HTMLから商品カードを取り出す（純関数・selftest対象）。 */
export function parseTakaraTomyList(html: string): TakaraTomyCard[] {
  const $ = cheerio.load(html);
  const cards: TakaraTomyCard[] = [];
  $("a.tt_product2-6").each((_, el) => {
    const a = $(el);
    const href = a.attr("href") ?? "";
    const goodsId = href.match(/\/shop\/g\/g([^/]+)/)?.[1];
    const name = a.find(".tt_product2-6__name").first().text().replace(/\s+/g, " ").trim();
    if (!goodsId || !name) return;

    const priceText = a.find(".tt_product2-6__price").first().text().replace(/\s+/g, " ").trim();
    // 「6,600円（税込）」だけを価格として扱う。「対象のコードをご使用ください(無料）」の
    // ような**購入条件の説明**を価格欄に写すと、金額でないものが価格として並ぶ。
    const yen = priceText.match(/([\d,]+)\s*円/)?.[1] ?? null;

    const labels = a
      .find(".tt_label1-1 li")
      .map((_, li) => $(li).text().replace(/\s+/g, " ").trim())
      .get()
      .filter(Boolean);
    const isOriginal = a
      .find(".tt_label2-1 li")
      .toArray()
      .some((li) => /オリジナル/.test($(li).text()));

    const releaseText =
      a
        .find(".tt_product2-6__target")
        .map((_, p) => $(p).text().replace(/\s+/g, " ").trim())
        .get()
        .find((t) => /発売日/.test(t))
        ?.replace(/^発売日\s*[:：]\s*/, "") ?? null;

    const action = a.find(".tt_product2-6_cartbutton button").first().text().trim() || null;
    const img = a.find(".tt_product2-6__image img").first();
    const src = img.attr("data-src") ?? img.attr("src") ?? null;

    cards.push({
      goodsId,
      name,
      price: yen ? `${yen}円` : null,
      labels,
      isOriginal,
      releaseText: releaseText || null,
      action,
      imageUrl: src ? (src.startsWith("http") ? src : `${STORE}${src}`) : null,
    });
  });
  return cards;
}

/**
 * 「発売日：…」を日付に読む（純関数・selftest対象）。
 *
 * **日を作らない**のが約束（ミス15）。「2026年9月中旬」「2027年4月中旬発送予定」は
 * 月精度なので eventDate は月初に置きつつ eventDateText を残し、表示側
 * （isMonthPrecision）に「2026年9月」と月までしか出させない。
 */
export function parseTakaraTomyRelease(
  text: string | null
): { date: Date | null; text: string | null } {
  if (!text) return { date: null, text: null };
  const full = text.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (full) {
    return { date: calendarDate(Number(full[1]), Number(full[2]), Number(full[3])), text: null };
  }
  const ym = text.match(/(\d{4})年\s*(\d{1,2})月/);
  if (ym) {
    return { date: calendarDate(Number(ym[1]), Number(ym[2]), 1), text };
  }
  return { date: null, text };
}

/** ボタン文言とラベルから、サイトの eventType 語彙に落とす（純関数・selftest対象）。 */
export function takaraTomyEventType(card: TakaraTomyCard): string {
  // 収集元が「抽選に応募する」と書いている時だけ抽選と言う（推測で抽選にしない）。
  if (card.action && /抽選/.test(card.action)) return "抽選";
  if (card.labels.some((l) => /再入荷/.test(l))) return "再販";
  if (card.labels.some((l) => /予約/.test(l)) || (card.action && /予約/.test(card.action))) {
    return "予約";
  }
  return "発売";
}

/** 商品名からサイトのジャンル語彙に振り分ける（純関数・selftest対象）。 */
export function takaraTomyGenre(name: string): string {
  if (/ポケモン|ポケットモンスター|ポケピース/.test(name)) return "ポケモン";
  if (/デュエル・?マスターズ|デュエマ|トレーディングカード|カードゲーム|スタートデッキ/.test(name)) {
    return "トレカ";
  }
  if (/フィギュア|ねんどろ|ソフビ/.test(name)) return "フィギュア";
  if (/プラモ|プラモデル/.test(name)) return "プラモ";
  if (/ぬいぐるみ|マスコット|アクリル|キーホルダー/.test(name)) return "キャラグッズ";
  return "玩具";
}

export async function scrapeTakaraTomyMall(): Promise<ScrapedItem[]> {
  const today = todayJst();
  const byId = new Map<string, ScrapedItem>();

  for (const list of LISTS) {
    let html: string;
    try {
      html = await fetchHtmlDetectCharset(`${STORE}${list.path}`);
    } catch {
      continue;
    }
    await sleep(600);

    for (const card of parseTakaraTomyList(html)) {
      if (byId.has(card.goodsId)) continue;
      const { date, text } = parseTakaraTomyRelease(card.releaseText);
      // 発売日が過ぎた行はそのまま入れても表示側で落ちる。巡回結果を膨らませないため先に切る。
      if (date && date.getTime() < today.getTime() && !/中旬|上旬|下旬/.test(card.releaseText ?? "")) {
        continue;
      }
      byId.set(card.goodsId, {
        source: "takaratomy_mall",
        sourceId: card.goodsId,
        title: card.name,
        genre: takaraTomyGenre(card.name),
        // 「オリジナル」＝モール限定。転売視点で一番効く事実なので、絞り込みに残す。
        subGenre: card.isOriginal ? "モール限定" : null,
        eventType: takaraTomyEventType(card),
        eventDate: date,
        eventDateText: text,
        price: card.price,
        url: `${STORE}/shop/g/g${card.goodsId}/`,
        imageUrl: card.imageUrl,
      });
    }
  }

  return [...byId.values()];
}
