const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(`fetch failed: ${url} (${res.status})`);
  }
  return res.text();
}

// 日付は「時刻を持たない暦日」として UTC 0時で作る。
// ローカル時刻(JST)で作ると、UTCで動く本番サーバーで1日ズレて表示されるため。
function calDate(y: number, month1: number, d: number): Date {
  return new Date(Date.UTC(y, month1 - 1, d));
}

/** "20260806" -> Date(2026-08-06) */
export function parseYyyymmdd(id: string): Date | null {
  const m = id.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const month = Number(mo);
  const day = Number(d);
  // figislandには「2026年08月登場予定」(日未定)を id=20260800 で表す見出しがある。
  // 日=00 のまま calDate に渡すと「前月末日」に化け（20260800→7/31, 20260700→6/30＝過去落ちで非表示）、
  // 月しか分からない商品を誤った特定日に見せてしまう。範囲外は日付未定(null)として扱う。
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return calDate(Number(y), month, day);
}

/** "2026年8月6日" -> Date */
export function parseJapaneseFullDate(text: string): Date | null {
  const m = text.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return calDate(Number(y), Number(mo), Number(d));
}

/** "2026年9月" (発送予定など) -> Date(その月の1日) */
export function parseJapaneseYearMonth(text: string): Date | null {
  const m = text.match(/(\d{4})年\s*(\d{1,2})月/);
  if (!m) return null;
  const [, y, mo] = m;
  return calDate(Number(y), Number(mo), 1);
}

/** "7/2 (木)" のような月日を、基準の年月から年を補って Date にする */
export function parseSlashMonthDay(text: string, baseYear: number, baseMonth: number): Date | null {
  const m = text.match(/(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  // 12月ページに載る1月発売などをまたぐ補正
  let year = baseYear;
  if (month < baseMonth - 1) year += 1;
  return calDate(year, month, day);
}

/**
 * 年の無い「7月6日」を日付にする。**基準日にいちばん近い年**を選ぶ。
 *
 * 以前は「60日以上前なら翌年」という規則だった。これは *過ぎた日付を未来に化けさせる*:
 *  ・rarecheck … 数ヶ月前の記事の「4月28日」が **2027年4月28日** になり、掲載9件中7件が
 *    2027年4〜6月という嘘の日付で並んでいた。
 *  ・nyuka_now … 小売の応募ページに残る過去の「6月2日」が **2027年6月2日** になり、
 *    「今日以降で最も近い日を表示日にする」という正しいはずの選別を素通りして、
 *    10ヶ月先の抽選日として表示されていた（3件）。
 *
 * 最も近い年なら「6月2日」(基準8/8)は 67日前の今年になり過去として扱える。
 * 「1月7日」は 152日後の翌年になり、年またぎの先行情報も正しく読める。
 * **基準日は記事の投稿日を渡すこと**（呼び出し側の責任）。今日を基準にすると、
 * 古い記事の日付が「まだ来ていない日」に見えてしまう。
 */
export function resolveMonthDay(month: number, day: number, reference = new Date()): Date {
  const base = reference.getUTCFullYear();
  let best = calDate(base, month, day);
  for (const y of [base - 1, base + 1]) {
    const cand = calDate(y, month, day);
    if (Math.abs(cand.getTime() - reference.getTime()) < Math.abs(best.getTime() - reference.getTime()))
      best = cand;
  }
  return best;
}

/** Extract first "N月N日" occurrence + optional event-type keyword from free text */
/**
 * @param reference 年の無い「4月28日」をどの時点から見て解決するか。
 *   **記事の投稿日を渡すこと。** 省略すると「今日」基準になり、数ヶ月前の記事に書かれた
 *   過去の日付が「まだ来ていない日」と解釈されて**翌年に倒れる**。
 *   実測: rarecheck の掲載9件中7件が 2027年4〜6月 と表示されていた（実際は2026年＝過去）。
 *   日付の正確さがこのサイトの中核価値なので、基準点を推測に委ねない。
 */
export function extractDateAndEventFromText(
  text: string,
  reference?: Date | string | null
): { date: Date | null; eventType: string | null; dateText: string | null } {
  const dateMatch = text.match(/(\d{1,2})月(\d{1,2})日(?:\([月火水木金土日]\))?(?:\s*(\d{1,2})時)?/);
  const eventMatch = text.match(/(予約開始|抽選|受付開始|販売開始|発売開始|発売|値下げ|再販|再登場)/);
  if (!dateMatch) {
    return { date: null, eventType: eventMatch ? eventMatch[1] : null, dateText: null };
  }
  const month = Number(dateMatch[1]);
  const day = Number(dateMatch[2]);
  const ref = reference ? new Date(reference) : new Date();
  return {
    date: resolveMonthDay(month, day, Number.isNaN(ref.getTime()) ? new Date() : ref),
    eventType: eventMatch ? eventMatch[1] : null,
    dateText: dateMatch[0],
  };
}

// 配信元のタイトルには、日付欄と重複する告知（「7月24日より開催!」）や
// 編集タグ（【新着】【オススメ】）が付いていることが多い。商品名として読みやすくするため落とす。
const NOISE_TAGS =
  /^(?:【(?:新着|速報|再販|再入荷|注目|人気|限定|オススメ|おすすめ|超オススメ|超絶オススメ)】\s*)+/;
const LEADING_DATE = /^\d{1,2}\/\d{1,2}(?:・\d{1,2}\/\d{1,2})*\s*(?:発売|抽選|予約)?\s*[｜|]\s*/;
const TRAILING_DATE =
  /\s*\d{1,2}月\d{1,2}日(?:から|より)?\s*(?:順次)?\s*(?:発売|開催|登場|開始|実施|販売|予約開始|受付開始)(?:決定|予定|中)?\s*[!！]*\s*$/;
// TRAILING_DATE が「東京・大阪で8月25日より開催!」の日付部分だけを削ると、
// 「〜プリンセスカフェ、東京・大阪で」と地名＋助詞が宙ぶらりんに残る（実測2件）。
// 地名は語彙を固定し、末尾の「(、)地名(・地名)*(ほか)で/にて」だけを落とす。
const LOC = "東京|大阪|京都|名古屋|福岡|札幌|仙台|広島|横浜|池袋|秋葉原|渋谷|新宿|原宿|梅田|難波|天神|沖縄|全国|各地";
const TRAILING_LOCATION = new RegExp(
  `\\s*、?\\s*(?:${LOC})(?:・(?:${LOC}))*(?:ほか|など)?(?:で|にて)$`
);

/** タイトルから日付告知・編集タグを取り除いて商品名として読みやすくする */
export function cleanTitle(raw: string): string {
  let t = raw.trim();
  t = t.replace(NOISE_TAGS, "");
  t = t.replace(LEADING_DATE, "");
  t = t.replace(TRAILING_DATE, "");
  t = t.replace(TRAILING_LOCATION, "");
  // 「◯◯」が登場！ 型の告知ラッパー。外側の「」ごと剥がして商品名だけにする。
  // 実測: pokemon_goods「「一番くじ ポケモンマスターズ EX 7th Anniversary」が登場！」が
  // ichiban_kuji の同一くじとタイトル不一致になり、同じ1kuji.comのURLを指す2枚が並んだ。
  t = t.replace(/\s*(?:が|も)\s*(?:新?登場|お目見え)\s*[!！]*\s*$/, "");
  const wrapped = t.match(/^「(.{4,})」$/);
  if (wrapped) t = wrapped[1].trim();
  t = t.trim();
  // 削りすぎて短くなった場合は元に戻す（安全側）
  return t.length >= 4 ? t : raw.trim();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 全角英数を半角に正規化する */
function toHalfWidth(s: string): string {
  return s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

/** トップレベルのジャンルを本文/カテゴリから推定して正規化する */
export function classifyGenre(text: string): string {
  const norm = toHalfWidth(text);
  const t = norm.toLowerCase();
  // 「一番くじ」は独立ジャンル（コラボ扱いにしない）
  if (/一番くじ/.test(norm)) return "一番くじ";
  if (/フィギュア|フィギュアーツ|ねんどろ|プライズ|scale|スケール|ぬいぐるみ|monsterarts|figuarts/i.test(norm)) {
    return "フィギュア";
  }
  // 「楽天カード」等の誤検出を避けるため、"カード" 単体では判定しない
  if (/トレカ|トレーディングカード|カードゲーム|ポケカ|ポケモンカード|ワンピースカード|ワンピカード|遊戯王|デュエマ|デュエル・?マスターズ|mtg|ヴァイスシュヴァルツ|ブースターパック|拡張パック|スターターデッキ/i.test(norm)) {
    return "トレカ";
  }
  if (/ガンプラ|プラモ|プラモデル|\bmg\b|\bhg\b|\brg\b|\bpg\b|\bhguc\b|\bmgsd\b|\bsdw?\b|1\/144|1\/100|1\/60|ガンダム|エヴァ/i.test(t)) {
    return "プラモ";
  }
  if (/スニーカー|sneaker|nike|adidas|new balance|jordan|dunk|asics|エアフォース|エアマックス|エアジョーダン/i.test(t)) {
    return "スニーカー";
  }
  if (/ブルーレイ|blu-ray|dvd|4k|steelbook|スチールブック/i.test(t)) return "映像・音楽";
  // ジャンル名は itemFilter.ts の GENRE_ORDER の語彙に揃える。「ゲーム」という別ラベルを
  // 出すと、同じ商品が「ゲーム」と「家電・ゲーム機」に散り、絞り込みからも漏れる。
  if (/ゲーム|game|switch|playstation|quest|meta/i.test(t)) return "家電・ゲーム機";
  return "その他";
}
