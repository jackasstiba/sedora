import * as cheerio from "cheerio";
import { ScrapedItem } from "./types";
import { fetchHtml, parseYyyymmdd, sleep } from "./util";

// トレカ速報（ota-goods.info）のTCG発売日カレンダー。
// 既存の torecamap は「更新が遅く陳腐化しがち」なため、より網羅的で最新の一次カレンダーで補強する。
// 全ソースをまたいで /tcg/[title] のタイトル別ページにも供給される。
//
// 構造: ul.goods_list の中に、日付ヘッダ <li.releasedate-section data-release="YYYYMMDD"> と
// 商品 <li.goods_info> が同列で交互に並ぶ（date-grouped flat list）。商品の日付は
// 直前の releasedate-section から引き継ぐ。各商品に 画像/商品名/価格/メーカー/安定ID(archives/{id}) あり。
const BASE = "https://ota-goods.info/tcg/month_release.php";
const MONTHS_AHEAD = 2; // 今月＋2ヶ月分

function monthParams(): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i <= MONTHS_AHEAD; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}01`;
    out.push(ym);
  }
  return out;
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

export async function scrapeTorecasoku(): Promise<ScrapedItem[]> {
  const items: ScrapedItem[] = [];
  const seen = new Set<string>();

  for (const ym of monthParams()) {
    let html: string;
    try {
      html = await fetchHtml(`${BASE}?date=${ym}&disp=1`);
    } catch {
      continue;
    }
    const $ = cheerio.load(html);

    // 日付ヘッダと商品が同列に並ぶ本体リストだけを対象にする（releasedate-section を含む ul）。
    $("ul.goods_list")
      .filter((_, ul) => $(ul).children("li.releasedate-section").length > 0)
      .each((_, ul) => {
        let currentDate: Date | null = null;

        $(ul)
          .children("li")
          .each((_, li) => {
            const $li = $(li);

            if ($li.hasClass("releasedate-section")) {
              const dr = $li.attr("data-release") ?? "";
              currentDate = parseYyyymmdd(dr);
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

            items.push({
              source: "torecasoku",
              sourceId,
              title,
              genre: classifyTorecasokuGenre(title),
              subGenre: maker || null,
              eventType: "発売",
              eventDate: currentDate,
              eventDateText: null,
              price,
              url: href,
              imageUrl,
            });
          });
      });

    await sleep(600);
  }

  return items;
}
