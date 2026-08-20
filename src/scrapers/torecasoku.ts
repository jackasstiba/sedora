import * as cheerio from "cheerio";
import { ScrapedItem } from "./types";
import { jstYearMonth } from "../lib/date";
import { fetchHtml, parseYyyymmdd, sleep } from "./util";
import { isSuspectPackPrice } from "../lib/margin";

// トレカ速報（ota-goods.info）のTCG発売日カレンダー。
// 既存の torecamap は「更新が遅く陳腐化しがち」なため、より網羅的で最新の一次カレンダーで補強する。
// 全ソースをまたいで /tcg/[title] のタイトル別ページにも供給される。
//
// 構造: ul.goods_list の中に、日付ヘッダ <li.releasedate-section data-release="YYYYMMDD"> と
// 商品 <li.goods_info> が同列で交互に並ぶ（date-grouped flat list）。商品の日付は
// 直前の releasedate-section から引き継ぐ。各商品に 画像/商品名/価格/メーカー/安定ID(archives/{id}) あり。
const BASE = "https://ota-goods.info/tcg/month_release.php";
// 2026-08-15 実測: 固定「先2ヶ月」では 11月28・12月8・1月1件が窓の外だった（TCGの予約は
// 3〜5ヶ月先まで告知される。本人が収集元で取り漏れを発見）。固定値はいつか収集元の
// 告知範囲に追い越されるので、**空の月が2つ続くまで**進める適応型にする（上限12ヶ月）。
const MAX_MONTHS = 12;
const STOP_AFTER_EMPTY = 2;

function monthParam(offset: number): string {
  // 月は必ず日本時間で決める（ローカル時刻だと実行環境のTZで月がズレる）。
  const { year, month } = jstYearMonth(offset);
  return `${year}${String(month).padStart(2, "0")}01`;
}

// サムネイルURLの "-190x260" のようなサイズ接尾辞を除いてフル画像URLにする。
function toFullImage(src: string | undefined): string | null {
  if (!src) return null;
  return src.replace(/-\d+x\d+(\.[a-z]+)(\?.*)?$/i, "$1");
}

// トレカ速報の「TCG」カレンダーには、実カード（パック/デッキ/スリーブ等）だけでなく、
// そのIPの関連グッズ（缶バッジ・アクリルスタンド・フィギュア・リング等）も混在する。
// これを一律 genre="トレカ" にすると /tcg/[title] が同シリーズのグッズで埋まり本物のカードが埋もれる。
// → フランチャイズ名ではなく「商品タイプ」で正しいジャンルへ振り分ける。
// 判定順は重要: ゲーム→グッズ(アクリル等)→フィギュア→カード類→その他。
// 例「アクリルスタンドフィギュア」はフィギュアでなくグッズ(その他)、
//   「フィギュア付き限定版 Switch版」はフィギュアでなくゲームに落とす。
// カード判定はフランチャイズ名でなく商品タイプで行う（遊戯王グッズが誤ってトレカに入るのを防ぐ）。
const GAME_RE = /Switch\s?2?版?|PS5|PS4|PlayStation|Steam|Nintendo\s?Switch|ゲームソフト/i;
const GOODS_RE =
  /缶バッジ|アクリル|キーホルダー|ラバスト|ラバーストラップ|ストラップ|リング|指輪|ネックレス|ペンダント|タペストリー|クッション|マグカップ|グラス|Tシャツ|パーカー|ステッカー|シール|ポーチ|タオル|時計|マスコット|ブロマイド|ポストカード|下敷き|ジグソー|パズル|ぬいぐるみ|ナノブロック|petadoll/i;
const FIGURE_RE = /フィギュア|スケール|ねんどろ|ソフビ|フィギュアーツ|アクションフィギュア/i;
const CARD_RE =
  /ブースター|拡張パック|デッキ|トライアルセット|スリーブ|ラバーマット|プレイ(?:ヤーズ)?マット|カードローダー|バインダー|トレーディングカード|カードゲーム|シングルカード|カードダス|Reバース|フュージョンワールド|オーバーラッシュ|Secret\s?Lair|Commander|\bMTG\b|マジック[:：]?ザ|\bTCG\b|Booster|Starter|Card\s?Game|Bundle|パック/i;

function classifyTorecasokuGenre(title: string): string {
  if (GAME_RE.test(title)) return "家電・ゲーム機"; // 語彙は GENRE_ORDER に揃える
  if (GOODS_RE.test(title)) return "その他";
  if (FIGURE_RE.test(title)) return "フィギュア";
  if (CARD_RE.test(title)) return "トレカ";
  return "その他";
}

/** 月別ページ1枚から商品行を取り出す（純関数・selftest対象）。 */
export function parseTorecasokuList(html: string, seen: Set<string> = new Set()): ScrapedItem[] {
  const items: ScrapedItem[] = [];
  const $ = cheerio.load(html);

  // 日付ヘッダと商品が同列に並ぶ本体リストだけを対象にする（releasedate-section を含む ul）。
  $("ul.goods_list")
    .filter((_, ul) => $(ul).children("li.releasedate-section").length > 0)
    .each((_, ul) => {
        let currentDate: Date | null = null;
        let currentDateText: string | null = null;

        $(ul)
          .children("li")
          .each((_, li) => {
            const $li = $(li);

            if ($li.hasClass("releasedate-section")) {
              const dr = $li.attr("data-release") ?? "";
              currentDate = parseYyyymmdd(dr);
              // 見出しの**文言**も持ち帰る。理由は2つ:
              //  ① 日付を属性(`data-release`)から作っているので、属性と文言が食い違ったときに
              //     気付く手立てが要る（figisland は収集元が id を使い回していて2週間ズレた）。
              //     文言を保存しておけば audit の date_text_mismatch が毎回突き合わせる。
              //  ② 収集元は「8月1日（土）頃発売」と**頃**を付けている。こちらが「発売日 8/1(土)」
              //     と言い切ると、収集元より強い約束をすることになる。
              // ⚠️ 「未定」セクションの見出しは日付ではなく**開閉ボタンの文言**（「▼ 未定 商品を表示 ▼」）。
              // これを保存すると日付欄にそのまま出る（実測 2026-08-20: 観点Aの突合で発覚、表示中61件）。
              // 日付が読めた見出しの文言だけを保存する。
              currentDateText = currentDate ? $li.text().replace(/\s+/g, " ").trim() || null : null;
              return;
            }
            if (!$li.hasClass("goods_info")) return;

            const link = $li.find(".title a").first();
            const href = link.attr("href") ?? "";
            const title = link.text().replace(/\s+/g, " ").trim();
            if (!title || !href) return;

            const idMatch = href.match(/\/archives\/(\d+)/);
            const sourceId = idMatch ? idMatch[1] : href;
            // 同一商品が複数月ページに重複して載ることがあるため dedup。
            if (seen.has(sourceId)) return;
            seen.add(sourceId);

            const price = $li.find(".price").first().text().replace(/\s+/g, "").trim() || null;
            // メーカーは .group_parent 内の .title/.price 以外の div。
            const maker = $li
              .find(".group_parent > div")
              .filter((_, d) => {
                const c = $(d).attr("class") ?? "";
                return !c.includes("title") && !c.includes("price");
              })
              .first()
              .text()
              .trim();

            const imageUrl = toFullImage($li.find(".thumbnail img").first().attr("src"));

            const genre = classifyTorecasokuGenre(title);
            items.push({
              source: "torecasoku",
              sourceId,
              title,
              genre,
              subGenre: maker || null,
              eventType: "発売",
              eventDate: currentDate,
              eventDateText: currentDateText,
              // 販売単位の表記が無いのにBOX級の価格が付く商品がある（定価ともBOX価格とも
              // 裏取りできない）。裏取りできない価格は載せない。
              price: isSuspectPackPrice(genre, title, price) ? null : price,
              url: href,
              imageUrl,
            });
          });
    });

  return items;
}

export async function scrapeTorecasoku(): Promise<ScrapedItem[]> {
  const items: ScrapedItem[] = [];
  const seen = new Set<string>();

  let emptyStreak = 0;
  for (let mi = 0; mi < MAX_MONTHS && emptyStreak < STOP_AFTER_EMPTY; mi++) {
    const ym = monthParam(mi);
    const monthStart = items.length;
    let html: string;
    try {
      html = await fetchHtml(`${BASE}?date=${ym}&disp=1`);
    } catch {
      emptyStreak++;
      continue;
    }
    items.push(...parseTorecasokuList(html, seen));

    // 同一商品の複数月重複は dedup 済みなので、「この月で新規に増えたか」で空月を判定する。
    emptyStreak = items.length > monthStart ? 0 : emptyStreak + 1;
    await sleep(600);
  }

  return items;
}
