import { ScrapedItem } from "./types";
import { todayJst } from "../lib/date";
import { classifyGenre, fetchHtml, parseJapaneseFullDate, sleep } from "./util";
import {
  extractDrawFee,
  extractRafflePeriod,
  extractRafflePrizes,
  formatRafflePrizeHighlights,
} from "./raffleKujiEnrich";

// オンラインくじプラットフォーム（raffle-kuji.jp）の「開催中」抽選を収集する。
// 一番くじ倶楽部（1kuji.com）に次ぐ2つ目の一次くじプラットフォーム源。
//
// 一番くじ以外のキャラくじ（アニメ/アイドル/VTuber等）は各社がSPAで直取り困難な穴に
// なっていたが、本プラットフォームはくじの応募が実際に行われる一次的な場で、
// /lotteries 一覧が server-rendered（素 fetch 可）。個別の /lotteries/[id] が応募ページ。
//
// ソースの見せ方: 一番くじ倶楽部と同じく「応募が行われる一次プラットフォーム」扱いなので、
// item.url は /lotteries/[id]（＝実際の応募ページ）に直リンクする（outbound.isOfficialUrl）。
// まとめ/ミラー系ではないため、収集元名（サイトのブランド名）はフロントに出さない
// ハツコレ方針のまま中立ラベル（itemFilter の SOURCE_LABELS）を割り当てる。

const LIST_URL = "https://raffle-kuji.jp/lotteries";

// 一覧の各くじカード（server-rendered）。
// <a class="LotteryEventList_raffle_itemBlock__XXXX" href="/lotteries/1297"> ...card... </a>
const CARD_RE =
  /<a class="LotteryEventList_raffle_itemBlock__[^"]*" href="\/lotteries\/(\d+)">([\s\S]*?)<\/a>/g;

/** カード内側から各フィールドを取り出す（クラス名のハッシュ接尾辞はワイルドカードで許容）。 */
function parseCard(inner: string) {
  const title = inner
    .match(/LotteryEventList_raffle_itemName__[^"]*"[^>]*>([^<]+)</)?.[1]
    ?.trim();
  const imageUrl =
    inner.match(/<img src="(https:\/\/s\.butterfly\.fan\/[^"]+)"/)?.[1] ?? null;
  // 締切ブロックは svg アイコン + テキスト「YYYY年MM月DD日 23:59 まで」。タグを除去して読む。
  const dateBlock = inner.match(/LotteryEventList_raffle_itemDate__[^"]*">([\s\S]*?)<\/div>/)?.[1];
  const deadlineText = dateBlock
    ? dateBlock.replace(/<[^>]+>/g, "").replace(/ /g, " ").trim()
    : null;
  return { title, imageUrl, deadlineText };
}

export async function scrapeRaffleKuji(): Promise<ScrapedItem[]> {
  // 「日本時間の今日」を暦日(UTC0時)で。締切が過去の抽選（受付終了）は載せない。
  const today = todayJst();

  const html = await fetchHtml(LIST_URL);
  const byId = new Map<string, ScrapedItem>();

  for (const m of html.matchAll(CARD_RE)) {
    const id = m[1];
    if (byId.has(id)) continue;
    const { title, imageUrl, deadlineText } = parseCard(m[2]);
    if (!title) continue;

    // 締切＝応募締切日。これを eventDate（＝いつまでに動くべきか）として使う。
    const deadline = deadlineText ? parseJapaneseFullDate(deadlineText) : null;
    if (deadline && deadline.getTime() < today.getTime()) continue; // 受付終了は除外

    byId.set(id, {
      source: "raffle_kuji",
      sourceId: id,
      title,
      genre: classifyGenre(title),
      subGenre: null,
      eventType: "抽選",
      eventDate: deadline,
      // 収集元の締切文言をそのまま持つ（"2026年08月20日 23:59 まで"）。捨てていたので:
      //  ① **時刻が画面から消えていた**。「今から間に合うか」を決めるのは時刻のほう
      //     （eventPeriodText が時刻を含む文言だけを日付の下に出す）。
      //  ② 日付と突き合わせる相手が無く、audit の date_text_mismatch の母数から丸ごと外れていた。
      eventDateText: deadlineText ?? "抽選 受付中",
      price: null,
      // 応募が実際に行われる一次ページ（＝応募ページ）に直リンク。
      url: `https://raffle-kuji.jp/lotteries/${id}`,
      imageUrl,
      hasLottery: true,
    });
  }

  const items = [...byId.values()];

  // 一覧では“いくらで引けるか／何が当たるか”に届かない。各くじの詳細ページを開いて
  // 抽選1回の金額（price）／賞品ラインナップ要約（highlights＝カードの「🎯 注目賞品」枠）／
  // 賞画像ギャラリー（prizes JSON＝詳細ページで当選確率バッジ＋賞品画像を表示）を補う。
  // レート制限つき・失敗時はその1件の深掘りだけ諦めて一覧情報は活かす（壊さない）。
  for (const item of items) {
    try {
      const detail = await fetchHtml(item.url);
      const fee = extractDrawFee(detail);
      if (fee) item.price = fee;
      // 受付期間は**応募ページ側を正とする**。一覧カードの「M月D日 23:59 まで」は
      // 個別ページの「~ 翌日 08:59」と9時間ズレていた（実測6件すべて）。一覧だけを信じると、
      // まだ応募できる朝に「締切済み」と表示することになる。
      const period = extractRafflePeriod(detail);
      if (period) {
        item.eventDate = period.end;
        item.eventDateText = period.text;
      }
      const prizes = extractRafflePrizes(detail);
      if (prizes.length) {
        const highlights = formatRafflePrizeHighlights(prizes);
        if (highlights) item.highlights = highlights;
        item.prizes = JSON.stringify(prizes);
      }
    } catch {
      // 詳細取得に失敗しても一覧情報（タイトル・締切・画像・応募URL）は活かす
    }
    await sleep(400);
  }

  return items;
}
