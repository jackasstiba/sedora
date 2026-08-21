// サーバー(Prisma)とクライアント(ブラウザ内フィルタ)で共有する、絞り込みの純粋ロジック。
// prisma を import しないこと（クライアントバンドルに載せるため）。
import { isStalePlan, plannedDateFromText, todayJst } from "./date";
import { parseYen } from "./margin";
import {
  parseStoresJson,
  soonestOpenDeadline,
  storeDayMs,
  summarizeStores,
  type StoreEntry,
} from "./stores";
import { cleanListTitle, hasProductSegment } from "./title";
import { groupSaleUnits, saleUnitLabel } from "./saleUnit";

export type ItemStatus = "reserve" | "lottery" | "release" | "now";
export type ItemWhen = "week" | "month";

// 日付なしのうち「日程未定の予定品」を表す eventType（＝いま買えるわけではない）。
export const TBD_EVENT_TYPES = ["登場予定", "開催"];

/** サイトで使うジャンルの語彙（表示順も兼ねる）。**ここに無いジャンルは監査でERROR**にする。
 *  語彙を固定しないと、スクレイパーを足すたびに「ゲーム」と「家電・ゲーム機」のような
 *  同義の別ラベルが増え、同じ商品が別ジャンルに散る（実測で分類ブレを検出）。 */
export const GENRE_ORDER = [
  "フィギュア",
  "トレカ",
  "スニーカー",
  "プラモ",
  "一番くじ",
  "くじ", // 一番くじ以外のくじブランド（セガ ラッキーくじ/フリューくじ/タイトー等）2026-08-15新設
  "コラボ",
  "ポケモン",
  // キャラクターのぬいぐるみ・雑貨（ちいかわマーケット/ガシャポン等）2026-08-18新設。
  // 既存ジャンルはどれも「作れる箱」が無く、実測でこの層は一次情報が0件だった
  // （ちいかわ29件は全部まとめ記事経由・ガシャポンは16件がコラボ記事の言及のみ）。
  "キャラグッズ",
  // 玩具メーカーの遊べる玩具（トミカ/プラレール/リカちゃん/ベイブレード等）2026-08-18新設。
  // 「その他」に流すと、モール限定・抽選交換品といった転売の本命が埋もれる。
  "玩具",
  "ソフビ・アートトイ",
  "家電・ゲーム機",
  "酒・ウイスキー",
  "映像・音楽",
  "その他",
];

// バラバラな eventType 文字列を、せどり視点の3グループに正規化する。
export const STATUS_EVENT_TYPES: Record<Exclude<ItemStatus, "now">, string[]> = {
  // 「予約」＝受付中と裏取りできないもの（プレミアムバンダイ。収集元の記事が更新されず
  // 受付状況を確認できないため「受付中」と断定しない）。予約タブには載せる＝買いに行ける。
  reserve: ["予約", "予約開始", "予約受付中", "受付開始"],
  lottery: ["抽選"],
  release: ["発売", "販売開始", "登場予定", "開催", "再販"],
};

const SOURCE_LABELS: Record<string, string> = {
  figisland: "フィギュアーランド",
  figisland_pb: "プレミアムバンダイ",
  koretore: "コレトレ!!",
  torecamap: "トレカの地図",
  snkrdunk: "スニーカーダンク",
  rarecheck: "レアチェック",
  channeltono: "ちゃんねらー速報",
  collabo_cafe: "コラボカフェ",
  ichiban_kuji: "一番くじ倶楽部",
  pokemon_goods: "ポケモン公式",
  pokemoncard: "ポケモンカード公式",
  nike_snkrs: "Nike SNKRS",
  torecasoku: "トレカ速報",
  x_watch: "X転売ウォッチ", // Claude for Chrome 巡回で拾った新規商品（src/lib/xWatch.ts）
  // nyuka_now / tenbaiquest は競合アグリを収集元にするが、フロントには収集元名を一切出さない
  // 方針（2026-08-04）。掲載は公式ストア（stores 列）や楽天検索に寄せる。中立ラベルにしておく
  // （現状このラベルはUIに表示していないが、将来露出しても収集元が漏れないように）。
  nyuka_now: "抽選情報",
  tenbaiquest: "抽選情報",
  // raffle_kuji は一次くじプラットフォーム（応募ページに直リンク）。ブランド名は出さず中立ラベル。
  raffle_kuji: "オンラインくじ",
  // kujimap は非公式アグリを収集元にするが名は出さない（url は各くじの公式LPに直リンク）。
  kujimap: "くじ情報",
  onepiece_card: "ワンピースカード公式",
  // card_chusen は非公式アグリ＝名は出さない（url は各店の応募ページに直リンク）。
  card_chusen: "トレカ抽選情報",
  // gunpla_resale も非公式アグリ＝名は出さない（url は楽天検索）。
  gunpla_resale: "ガンプラ再販情報",
  sofvi: "ソフビ情報",
  // 2026-08-18 追加。いずれも一次情報（公式ストア/公式の抽選告知）＝店名を出してよい。
  mita_draw: "ミタスニーカーズ抽選",
  chiikawa_market: "ちいかわマーケット",
  takaratomy_mall: "タカラトミーモール",
  billys: "BILLY'S ENT",
  medicom_toy: "メディコム・トイ",
  gashapon: "ガシャポン公式",
  // 2026-08-21 追加。POP MART 日本公式オンラインストア（一次情報）＝店名を出してよい。
  popmart: "POP MART公式",
  // 2026-08-21 追加。いずれも公式ストア/公式サイト（一次情報）＝店名を出してよい。
  nagano_market: "ナガノマーケット",
  mofusand_market: "mofusand公式ストア",
  hololive_shop: "hololive公式ショップ",
  gundam_gcg: "ガンダムカードゲーム公式",
  pokecen_online: "ポケモンセンターオンライン",
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

/** 抽選の日付が何の日かを決めるために要る材料。呼び出し側が行から渡す */
export type LotteryDateContext = {
  source: string;
  eventDate: Date | null;
  /** Item.stores（JSON配列文字列）。応募先ごとの締切/開始を持つ */
  stores?: string | null;
};

/**
 * 抽選の `eventDate` が **応募締切なのか受付開始なのか**を、実データから決める。
 * 決まらなければ null（＝断定しない）。
 *
 * 2026-08-19 に収集元ごとの実装を1本ずつ読んで確かめた:
 *  ・card_chusen … `lastDeadline()`＝締切。応募先ごとの締切は stores に入っている
 *  ・raffle_kuji … 応募締切日
 *  ・mita_draw   … 応募締切
 *  ・tenbaiquest … 「抽選＝タイトル内の締切日」
 *  ・nike_snkrs  … カレンダーの抽選/発売日（締切は eventDateText に別途入る）＝「抽選日」で正しい
 *  ・channeltono … タイトルに出た最初の「M月D日」を拾うだけ＝**何の日かは分からない**
 */
const LOTTERY_DEADLINE_SOURCES = new Set(["card_chusen", "raffle_kuji", "mita_draw", "tenbaiquest"]);
/** 日付を拾っただけで意味が確かめられない収集元（Xミラー系）。断定しない */
const LOTTERY_DATE_UNKNOWN_SOURCES = new Set(["channeltono", "rarecheck"]);

export function lotteryDateMeaning(ctx?: LotteryDateContext): string | null {
  if (!ctx) return null;
  // ① 応募先が同じ日を持っているなら、その店の言い方（締切/開始）が答え
  if (ctx.eventDate) {
    const stores = parseStoresJson(ctx.stores ?? null);
    const iso = ctx.eventDate.toISOString().slice(0, 10);
    const same = stores?.filter((s) => s.at === iso) ?? [];
    if (same.some((s) => s.kind === "締切")) return "応募締切";
    if (same.length && same.every((s) => s.kind === "開始")) return "受付開始";
  }
  // ② 収集元の実装で決まっているもの
  if (LOTTERY_DEADLINE_SOURCES.has(ctx.source)) return "応募締切";
  // ③ 意味が確かめられない収集元は「抽選日」と断定しない。拾った日付だとだけ言う
  if (LOTTERY_DATE_UNKNOWN_SOURCES.has(ctx.source)) return "告知の日付";
  return null;
}

/**
 * 日付欄の見出し。`${eventType}日` と機械的に繋ぐと「予約受付中日」「登場予定日」のような
 * 日本語にならない見出しが出る（実測・詳細ページで表示されていた）。
 * 「〜中」「〜予定」で終わる種別には「日」を付けない。
 */
export function eventDateHeading(
  eventType: string,
  eventDateText?: string | null,
  past?: boolean,
  lottery?: LotteryDateContext,
): string {
  // その日付が何の日なのかは、まず**収集元の文言**で決まる。プレミアムバンダイの
  // 「2026年10月発送予定」は予約日でも発売日でもなく発送月なので、eventType から
  // 「予約日」と機械的に作ると、10月に予約が始まるように読める（実測でそう出ていた）。
  if (eventDateText && /発送予定/.test(eventDateText)) return "発送予定";
  // 抽選は `${eventType}日` に落とすと **「抽選日」＝抽選が行われる日** と読める。
  // 実体は応募締切であることが多い（実測 2026-08-19: カーナベルの「〜8/21 23:59」＝応募締切を
  // 「抽選日 2026年8月21日(金)」と表示していた）。実データで決まるときだけ言い切る。
  if (eventType === "抽選") {
    const meaning = lotteryDateMeaning(lottery);
    if (meaning) return meaning;
  }
  // 日付が過ぎているのに見出しが「予定」のままだと、同じページのバッジ
  // （displayEventType が「登場済み」に倒す）と真っ向から矛盾する。
  // 実測 2026-08-18: sitemap掲載 2846件中 **222件** がこの状態だった（全て eventType="登場予定"）。
  // past は date.ts の isEventPast で判定した結果を渡すこと（判定を二重に書かない）。
  if (past && /予定$/.test(eventType)) return `${eventType.replace(/予定$/, "")}日`;
  return /(?:中|予定)$/.test(eventType) ? eventType : `${eventType}日`;
}

/**
 * 「抽選」種別に該当するかの純粋述語（サーバーのPrisma版 getItems と意味論を共有）。
 * eventType が「抽選」のものに加え、タイトルに「抽選」を含むもの（例: eventType=登場予定
 * だが「抽選販売」）も拾う。
 *
 * ただし snkrdunk（スニーカーダンク）は発売カレンダー由来で全商品のタイトル末尾に
 * 「｜抽選/販売/定価情報」という定型ラベルが付くため、title.includes("抽選") で拾うと
 * 通常発売品まで抽選タブに誤混入する（実測 抽選タブ55件中44件が snkrdunk の発売品）。
 * よってタイトル推定の対象から snkrdunk を除外する。真のスニーカー抽選は nike_snkrs
 * （eventType="抽選"）で拾えるので取りこぼさない。
 */
export function isLotteryItem(it: {
  eventType: string;
  title: string;
  /** 収集元。**クライアントへは渡さない**ので、その場合は代わりに `lottery` を渡す。 */
  source?: string;
  /** サーバー側で先に判定した結果（カードに渡す形＝CardItem はこちらを持つ）。 */
  lottery?: boolean;
  hasLottery?: boolean | null;
}): boolean {
  // 収集元の名前はブラウザに送らない（名前自体が「どこを巡回しているか」を明かすため）。
  // 送れないものに依存する判定は、サーバーで済ませてから真偽値だけ渡す。
  if (typeof it.lottery === "boolean") return it.lottery;
  if (it.eventType === "抽選") return true;
  // コラボ記事本文から抽選/ランダム賞品を検出したイベント（例: ホロライブ×極楽湯の
  // ランダム配布タオル）も抽選タブで拾う。イベント自体は eventType=開催 だが中身は抽選。
  if (it.hasLottery) return true;
  return it.source !== "snkrdunk" && it.title.includes("抽選");
}

// ── クロスソース重複の解消 ───────────────────────────────────────────────
// 複数の情報源が同じ商品を別々に載せると、一覧に同一カードが2枚以上出てしまう。
// 主因は figisland（フィギュアーランド）と koretore（コレトレ!!）が同じプライズ
// フィギュア新作をともに掲載すること（実測86組が重複）。表示層でまとめる。

type DedupeItem = {
  id: number;
  source: string;
  title: string;
  url: string | null;
  eventDate: Date | string | null;
  price: string | null;
  imageUrl: string | null;
  // 重複を畳む際に「落とす側」が持っていて「残す側」が欠く場合に引き継ぐ付加情報。
  // 主にX由来の実売相場(marketSource="x")が、後から載ったスクレイパー商品との
  // 重複解消で消えないようにするため（全て任意＝これらを持たない呼び出しにも無害）。
  marketPrice?: number | null;
  marketPriceText?: string | null;
  marketUrl?: string | null;
  marketSource?: string | null;
  hasLottery?: boolean | null;
  highlights?: string | null;
  // 「公式ページで見る」の遷移先。URLベースの重複突合（dedupeSameProductUrlCrossSource）が
  // 見る。持たない呼び出しにも無害（任意）。
  officialUrl?: string | null;
  // 応募先(店×応募ページ)のJSON。表示日を「まだ締切前の最短」に作り直すために見る
  // （applyLiveStoreDeadline）。持たない呼び出しにも無害（任意）。
  stores?: string | null;
};

/** 落とす重複 `from` が持つ相場/抽選/賞品情報を、残す代表 `keep` が欠くなら引き継ぐ。
 *  例: X巡回で相場を付けた x_watch 商品が、後から公式スクレイパーが同じ商品を載せたことで
 *  repScore に負けて落とされても、実売相場・抽選フラグが失われないようにする。 */
function inheritEnrichment(keep: DedupeItem, from: DedupeItem): void {
  if (keep.marketPrice == null && from.marketPrice != null) {
    keep.marketPrice = from.marketPrice;
    keep.marketPriceText = from.marketPriceText ?? keep.marketPriceText;
    keep.marketUrl = from.marketUrl ?? keep.marketUrl;
    keep.marketSource = from.marketSource ?? keep.marketSource;
  } else if (!keep.marketPriceText && from.marketPriceText) {
    keep.marketPriceText = from.marketPriceText;
    keep.marketUrl = keep.marketUrl ?? from.marketUrl;
    keep.marketSource = keep.marketSource ?? from.marketSource;
  }
  // 根拠(highlights)を伴わない hasLottery は引き継がない。フラグだけ渡ると「抽選と
  // 表示しているのに根拠が無い」行が生まれる（実測: tenbaiquest #23089 → channeltono
  // #57088。tenbaiquest 自身は検査対象外だが、引き継ぎ先は対象なので audit が鳴る）。
  // 残す側のタイトル/eventType が抽選なら抽選タブには元々入る＝表示上の損失は無い。
  if (!keep.hasLottery && from.hasLottery && from.highlights) keep.hasLottery = from.hasLottery;
  if (!keep.highlights && from.highlights) keep.highlights = from.highlights;
}

/** 重複判定用のタイトル正規化（記号・空白除去、全角半角/大小の吸収）。
 *  例: 「ワンピース Grandista-LUFFY-」→ "ワンピースgrandistaluffy"
 *  引用符（"" '' “” ‘’ 〝〟）も除去する。同一商品を figisland が“レゼ”、koretore が
 *  ‐レゼ‐ のように別の括り記号で載せると別キーになり重複が残っていたため。 */
// ゼロ幅スペース・BOM・ソフトハイフン等の「見えない文字」。実データに混入しており
// （collabo_cafe の「ぬいぐる​み」）、見た目は正常なのに検索と重複判定を壊す。
// 目視では絶対に見つからないので、機械側で必ず落とす。
export const INVISIBLE_CHARS = /[​-‍﻿⁠­]/g;

export function dedupeKey(title: string): string {
  return title
    .replace(INVISIBLE_CHARS, "") // ゼロ幅スペース等。見えないのに別キーになり重複が残る
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　]+/g, "")
    .replace(/[-‐-―ー－_,.、。!！?？「」『』【】\[\]()（）:：/／|｜~〜"'“”‘’〝〟＂＇]/g, "");
}

/** 重複グループで残す代表の優先度（大きいほど良い）。
 *  個別商品ページを持つURL（#アンカーでない）＞日付あり＞価格あり＞画像あり。
 *  figisland は商品ごとの個別URL（送客・SEO・詳細性で有利）を持つのに対し、
 *  koretore は一覧ページの #アンカー止まりなので、自然と figisland が残る。 */
function repScore(it: DedupeItem): number {
  let s = 0;
  if (it.url && !it.url.includes("#")) s += 8;
  if (it.eventDate) s += 4;
  if (it.price) s += 2;
  if (it.imageUrl) s += 1;
  return s;
}

/**
 * 同じ商品を複数ソースが別々に載せることによる一覧の重複表示を解消する。
 * 同じ正規化タイトルのアイテムが**複数ソースにまたがる**グループでは、最も情報が
 * 充実した1件（repScore＝個別商品ページURL＞日付＞価格＞画像、同点は若いid）だけを残す。
 *
 * ・同一ソース内だけの重複（例: Nikeの同名別カラー、Xミラーの再入荷通知の再掲）は
 *   別商品や別イベントの可能性があるため touch しない（誤マージ回避＝安全側）。
 * ・入力の並び順は保持する（残す代表は元の出現位置のまま）。
 * ・純関数（prisma非依存）。サーバーの各取得関数から呼び、件数と一覧を同じ出力から出す。
 */
export function dedupeCrossSource<T extends DedupeItem>(items: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    // 突合キーは**整形後**タイトルで作る。生タイトルで作ると、Xミラー(channeltono)は
    // 本文が実況ツイートまるごとなので、同じ商品でも他ソースと絶対に一致しない
    // （実測: トレカ速報と同一商品5組が重複したまま一覧に並んでいた）。
    const k = dedupeKey(cleanListTitle(it.source, it.title));
    if (k.length < 6) continue; // 短すぎるタイトルは別商品衝突の危険があるので触らない
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(it);
  }
  const drop = new Set<number>();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    if (new Set(g.map((x) => x.source)).size < 2) continue; // 同一ソースのみ→残す
    let best = g[0];
    for (const it of g) {
      if (it === best) continue;
      const d = repScore(it) - repScore(best);
      if (d > 0 || (d === 0 && it.id < best.id)) best = it;
    }
    // 代表を落とす前に、落とす側の相場/抽選情報を代表へ引き継ぐ（X由来の実売相場が
    // 後から載ったスクレイパー商品との重複解消で消えるのを防ぐ）。
    for (const it of g) {
      if (it.id === best.id) continue;
      inheritEnrichment(best, it);
      drop.add(it.id);
    }
  }
  return drop.size ? items.filter((it) => !drop.has(it.id)) : items;
}

/** 語順違いの重複を拾う anagram キー（dedupeKey をさらに文字ソートして順序を無視）。
 *  例:「超かぐや姫! 一番くじ ちょこっと」と「一番くじちょこっと 超かぐや姫！」は
 *  dedupeKey では語順が違い別キーだが、文字ソートすると一致する。 */
function anagramKey(title: string): string {
  return [...dedupeKey(title)].sort().join("");
}

/** 整形後タイトルの正規化キー（クロスソース突合はこちらを使う）。 */
function cleanKey(it: DedupeItem): string {
  return dedupeKey(cleanListTitle(it.source, it.title));
}

/**
 * 語順の入れ替えによるクロスソース重複を解消する（dedupeCrossSource の補助）。
 * 例: 一番くじ倶楽部が「一番くじ ◯◯」、コラボカフェが「◯◯ 一番くじ」と語順違いで
 * 同じくじを載せると dedupeKey が別キーになり残る。文字多重集合が完全一致（anagram）
 * かつクロスソースのグループだけを畳む。
 * ・anagram は誤マージの危険があるため、正規化後 10 文字以上のときだけ対象にする
 *   （短いタイトルの偶発一致を避ける。本番全件で誤マージ0を検証）。
 * ・同一ソース内のみの一致は touch しない（別カラー等の温存＝安全側）。
 */
function dedupeWordOrderCrossSource<T extends DedupeItem>(items: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    const c = cleanListTitle(it.source, it.title);
    if (dedupeKey(c).length < 10) continue;
    const k = anagramKey(c);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(it);
  }
  const drop = new Set<number>();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    if (new Set(g.map((x) => x.source)).size < 2) continue; // 同一ソースのみ→残す
    // dedupeKey が既に一致するものは dedupeCrossSource が処理済み。キー違い（＝真の語順違い）だけ扱う。
    if (new Set(g.map(cleanKey)).size < 2) continue;
    let best = g[0];
    for (const it of g) {
      if (it === best) continue;
      const d = repScore(it) - repScore(best);
      if (d > 0 || (d === 0 && it.id < best.id)) best = it;
    }
    for (const it of g) {
      if (it.id === best.id) continue;
      inheritEnrichment(best, it);
      drop.add(it.id);
    }
  }
  return drop.size ? items.filter((it) => !drop.has(it.id)) : items;
}

/** 暦日を UTC yyyy-mm-dd に正規化（時刻ゆらぎを無視した突合キー用） */
function dayISO(d: Date | string): string {
  return new Date(d).toISOString().slice(0, 10);
}

/**
 * スニーカーの日英別名によるクロスソース重複を解消する。
 * Nike SNKRS（公式・抽選エントリ）と スニーカーダンク（発売カレンダーのミラー）は
 * 同じ靴を「ナイキ エア ジョーダン…」「Nike Air Jordan…」と別言語タイトルで載せるため、
 * タイトル正規化ベースの dedupeCrossSource では拾えない。
 *
 * 突合キー＝発売日＋定価(円)。本番実データで一致した4ペアは全て同一の靴で、
 * snkrdunk 内に同キーの別商品は存在しなかった（誤マージ0を検証済み）。
 * 抽選情報を持つ公式の Nike SNKRS 側を残し、ミラーの snkrdunk 側を落とす。
 */
export function dedupeSneakerCrossSource<T extends DedupeItem>(items: T[]): T[] {
  const nikeKeys = new Set<string>();
  for (const it of items) {
    if (it.source !== "nike_snkrs" || !it.eventDate) continue;
    const y = parseYen(it.price);
    if (y) nikeKeys.add(`${dayISO(it.eventDate)}|${y}`);
  }
  if (nikeKeys.size === 0) return items;
  return items.filter((it) => {
    if (it.source !== "snkrdunk" || !it.eventDate) return true;
    const y = parseYen(it.price);
    return !y || !nikeKeys.has(`${dayISO(it.eventDate)}|${y}`);
  });
}

/**
 * url / officialUrl が指す「個別商品ページ」を突合キーに正規化する。商品ページでなければ null。
 * 判定は collaboEnrich.isSingleProductUrl と同じ（あちらは itemFilter を import しているため、
 * こちらから import すると循環になる＝ローカル実装。変えるときは両方見る）。
 */
export function productUrlKey(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const p = new URL(u);
    const seg = p.pathname.split("/").filter(Boolean);
    // ONE PIECEカードゲーム公式は /products/<種別>/<商品コード>/ の3段（実測 2026-08-21:
    // /products/boosters/op17/ を onepiece_card と torecamap が両方指してカードが2枚並んだ）。
    // 公式は1商品=1ページなので同一性キーにしてよい。他ホストの3段パスは知らないので適用しない。
    if (/(^|\.)onepiece-cardgame\.com$/i.test(p.hostname) && seg.length === 3 && /^products$/i.test(seg[0])) {
      return `${p.hostname.toLowerCase()}/${seg.map((s) => s.toLowerCase()).join("/")}`;
    }
    if (!(seg.length === 2 && /^(products?|item|items|goods)$/i.test(seg[0]))) return null;
    let slug = seg[1].toLowerCase();
    // 1kuji.com は再販売ページを「<商品コード>_2」のように版数付きで切る（実測:
    // kimetsu30=店頭販売 / kimetsu30_2=オンライン再販売）。版数を落として同じくじとして
    // 突合する。他ホストの命名規則は知らないので適用しない（知らないものに断定を足さない）。
    if (/(^|\.)1kuji\.com$/i.test(p.hostname)) slug = slug.replace(/_\d+$/, "");
    return `${p.hostname.toLowerCase()}/${seg[0].toLowerCase()}/${slug}`;
  } catch {
    return null;
  }
}

/**
 * 「同じ個別商品ページを指しているのに、タイトルの書き方が違って畳めない」クロスソース重複を
 * URL で解消する。
 *
 * 実測（2026-08-15 観点B）: collabo_cafe「ハンターハンター × 一番くじ グリードアイランド編」の
 * officialUrl と ichiban_kuji「一番くじ HUNTER×HUNTER GREED ISLAND ②」の url が完全に同じ
 * 1kuji.com/products/hxh11 なのに、タイトル正規化ベースの dedupe は全て素通りして同じくじの
 * カードが2枚並んでいた（鬼滅 上弦の弐 再販も同型）。タイトルは書き手の数だけあるが、
 * 個別商品ページURLは商品の同一性を最も強く主張する。
 *
 * 誤マージの安全弁: **同じ暦日**のものだけ畳む（同じ商品コードでも 店頭販売(7/30) と
 * オンライン再販(8/17) は別イベント＝別カードが正しい）。日付が無い行は触らない。
 */
function dedupeSameProductUrlCrossSource<T extends DedupeItem>(items: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    if (!it.eventDate) continue;
    const day = dayISO(it.eventDate);
    const keys = new Set(
      [productUrlKey(it.url), productUrlKey(it.officialUrl)].filter((k): k is string => !!k)
    );
    for (const k of keys) {
      const kk = `${k}|${day}`;
      (groups.get(kk) ?? groups.set(kk, []).get(kk)!).push(it);
    }
  }
  const drop = new Set<number>();
  for (const g of groups.values()) {
    const alive = g.filter((x) => !drop.has(x.id));
    if (alive.length < 2) continue;
    if (new Set(alive.map((x) => x.source)).size < 2) continue; // 同一ソースのみ→残す
    let best = alive[0];
    for (const it of alive) {
      if (it === best) continue;
      const d = repScore(it) - repScore(best);
      if (d > 0 || (d === 0 && it.id < best.id)) best = it;
    }
    for (const it of alive) {
      if (it.id === best.id) continue;
      inheritEnrichment(best, it);
      drop.add(it.id);
    }
  }
  return drop.size ? items.filter((it) => !drop.has(it.id)) : items;
}

/**
 * 同一ソースが同じ商品を別投稿で二重掲載するケースを解消する。
 * 例: ちゃんねらー速報が同じ商品を別コメントで再投稿し、実況コメントを剥がした整形後
 * タイトルが一致（生タイトルは違うので dedupeCrossSource では拾えない）。
 * **整形後タイトル＋発売日が完全一致**の同一ソースグループだけを畳む。別カラー・別弾は
 * 整形後タイトルが異なるので温存される（誤マージ回避＝安全側）。
 */
function dedupeSameSourceExact<T extends DedupeItem>(items: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    const key = dedupeKey(cleanListTitle(it.source, it.title));
    if (key.length < 8) continue; // 短い整形結果は別商品衝突の危険があるので触らない
    const day = it.eventDate ? dayISO(it.eventDate) : "none";
    const k = `${it.source}|${key}|${day}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(it);
  }
  const drop = new Set<number>();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    let best = g[0];
    for (const it of g) {
      if (it === best) continue;
      const d = repScore(it) - repScore(best);
      if (d > 0 || (d === 0 && it.id < best.id)) best = it;
    }
    for (const it of g) {
      if (it.id === best.id) continue;
      inheritEnrichment(best, it);
      drop.add(it.id);
    }
  }
  return drop.size ? items.filter((it) => !drop.has(it.id)) : items;
}

/**
 * 同一ソースが**完全に同じ生タイトル**で二重登録されているケースを畳む。
 * dedupeSameSourceExact は整形後タイトルの正規化キーが8字以上のものしか見ないため、
 * 短いタイトル（実測「コービー 5」#27860/#27861）が検査も解消もされず、一覧に同じカードが
 * 2枚並んでいた。生タイトルが1文字違わず同じなら別商品ではありえないので、長さ条件なしで畳む。
 */
function dedupeIdenticalTitle<T extends DedupeItem>(items: T[]): T[] {
  // 同一ソース・同一生タイトルでまず束ね、日付ごとの扱いはグループ内で決める。
  // 2026-08-15 実測: トレカ速報が同じ商品を「発売日 2026年11月未定」の旧記事と
  // 「11/21」の確定記事の両方で持ち続け（BS77・アイカツの2組）、day をキーに含む
  // 従来ロジックでは別グループになって二重掲載が残った。生タイトルが1字違わず同じで
  // 片方だけ日付なしなら、それは同じ商品の「月未定だった頃の記事」＝日付なし側を落とす。
  // 日付ありが複数（再販で別日）はどちらも本物なので温存する。
  const groups = new Map<string, T[]>();
  for (const it of items) {
    const k = `${it.source}|${it.title}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(it);
  }
  const drop = new Set<number>();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const dated = g.filter((it) => it.eventDate);
    const dateless = g.filter((it) => !it.eventDate);

    // 日付ありは同じ日どうしだけ畳む（別日＝再販は温存）
    const byDay = new Map<string, T[]>();
    for (const it of dated) {
      const day = dayISO(it.eventDate!);
      (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(it);
    }
    const collapse = (sub: T[]) => {
      if (sub.length < 2) return;
      let best = sub[0];
      for (const it of sub) {
        if (it === best) continue;
        const d = repScore(it) - repScore(best);
        if (d > 0 || (d === 0 && it.id < best.id)) best = it;
      }
      for (const it of sub) {
        if (it.id === best.id) continue;
        inheritEnrichment(best, it);
        drop.add(it.id);
      }
    };
    for (const sub of byDay.values()) collapse(sub);

    if (dated.length > 0 && dateless.length > 0) {
      // 日付確定版があるなら「月未定」版は同じ商品の古い記事。代表へ引き継いで落とす。
      const keep = dated.find((it) => !drop.has(it.id)) ?? dated[0];
      for (const it of dateless) {
        inheritEnrichment(keep, it);
        drop.add(it.id);
      }
    } else {
      collapse(dateless);
    }
  }
  return drop.size ? items.filter((it) => !drop.has(it.id)) : items;
}

/**
 * **同じ応募ページを指す同一ソースの行**が、商品名の書き方だけ違って2枚並ぶのを解消する。
 *
 * 実測（2026-08-18 観点B）: `/items/75445` と `/items/75446` は **url も stores も完全に同一**
 * （Joshinアプリ・〜8/17 23:59）で、片方の商品名がもう片方に丸ごと含まれていた。トップの
 * 1画面目に2枚並ぶので「**応募先が2つある**」と誤読する（＝1つの応募を2回できると思わせる）。
 *
 * **畳んでよいのは包含関係のあるものだけ。** 同じ応募ページURLを複数行が指すのは実測で
 * 13組あるが、その大半は**1つの応募ページで複数商品を同時抽選する正当なケース**だった
 * （例: 1つの店舗ページで「メガブレイブ」「メガシンフォニア」「スタートデッキ100」を同時受付）。
 * 名前が包含関係にあるとき（"…プロトロ" ⊂ "…プロトロ LOTR"）だけが「同じ商品の書き分け」で、
 * それ以外は別商品なので触らない。この条件で本番2177件を通すと**畳む対象は1組だけ**＝
 * 誤マージの余地がほとんど無い形になっている。
 *
 * 既存の `dedupeSameProductUrlCrossSource` が届かない理由は2つ:
 *   ①あちらは**別ソース同士**しか畳まない（同一ソースは温存する設計）
 *   ②あちらの突合キーは「個別商品ページURL」に限られ、店舗の応募ページ（`/lottery` 等）は対象外
 *
 * 安全弁: **stores が完全一致**（両方 null も含む）かつ**同じ暦日**のものだけ。応募先の集合が
 * 違うなら、それは畳むと情報が消える別の行。残すのは**より具体的な（長い）名前の方**
 * ＝短い方は書きかけ・総称で、情報量が少ない側。
 */
function dedupeSameSourceSameUrlContained<T extends DedupeItem>(items: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    if (!it.url) continue;
    const day = it.eventDate ? dayISO(it.eventDate) : "none";
    const k = `${it.source}|${it.url}|${it.stores ?? "none"}|${day}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(it);
  }
  const drop = new Set<number>();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const named = g.map((it) => ({ it, key: dedupeKey(cleanListTitle(it.source, it.title)) }));
    for (const a of named) {
      if (a.key.length < 8) continue; // 短い名前の偶発一致で別商品を潰さない
      for (const b of named) {
        if (a.it.id === b.it.id || drop.has(a.it.id) || drop.has(b.it.id)) continue;
        // b の名前が a に丸ごと含まれる＝b は a の書きかけ/総称。a を残して b を落とす。
        if (a.key === b.key || !a.key.includes(b.key)) continue;
        inheritEnrichment(a.it, b.it);
        drop.add(b.it.id);
      }
    }
  }
  return drop.size ? items.filter((it) => !drop.has(it.id)) : items;
}

/**
 * 同じ収集元の「まとめ記事」由来の行が、**同じ表示名で複数**並ぶのを解消する。
 *
 * 2026-08-18 実測: 抽選まとめの巡回範囲を8ページ→終端（17ページ）に広げたら、
 * `nyuka_now` に「ONE PIECE カードゲーム」という**まったく同じ表示名の行が2つ**出た。
 * まとめ記事の見出しが商品名になる設計なので、収集元が同じ名前の記事を複数持つと必ず起きる。
 * 画面には同じ文字列のカードが2枚並ぶだけで、**読む側には区別がつかない**（受付中ストアの
 * 「同じ表記が並ぶ」と同じ粗）。
 *
 * どちらを残すかは**測ってから決めた**（推測で畳まない）:
 *   #23075 … 応募先6件・受付開始 8/15 / 8/13 / 8/7（＝今まさに動いている）
 *   #91599 … 応募先12件だが中身は「交流会【7月開催】」「チャンピオンシップ2023」など
 *            *イベント*で、直近の動きは 6/16（63日前）＝古い総合ハブ記事
 * **応募先の件数で選ぶと古いハブが勝つ**ので、基準は「今日にいちばん近い動き」にする。
 *
 * 対象は `stores` を持つ行だけ（＝まとめ記事由来）。通常の商品行は別カラー・別弾があるので触らない。
 */
export function dedupeSameSourceSameName<T extends DedupeItem>(items: T[], today: Date): T[] {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    if (!it.stores) continue;
    const key = dedupeKey(cleanListTitle(it.source, it.title));
    if (key.length < 8) continue; // 短い名前の偶発一致で別商品を潰さない
    const k = `${it.source}|${key}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(it);
  }
  /** その行が持つ日付のうち、今日にいちばん近いものまでの日数（小さいほど「動いている」）。 */
  const nearestMoveDays = (it: T): number => {
    const stores = it.stores ? parseStoresJson(it.stores) : null;
    if (!stores?.length) return Number.POSITIVE_INFINITY;
    let best = Number.POSITIVE_INFINITY;
    for (const s of stores) {
      if (!s.at) continue;
      const d = Math.abs(new Date(`${s.at}T00:00:00.000Z`).getTime() - today.getTime()) / 86_400_000;
      if (d < best) best = d;
    }
    return best;
  };
  const drop = new Set<number>();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    let best = g[0];
    for (const it of g) {
      if (it === best) continue;
      const d = nearestMoveDays(best) - nearestMoveDays(it) || repScore(it) - repScore(best);
      if (d > 0 || (d === 0 && it.id < best.id)) best = it;
    }
    for (const it of g) {
      if (it.id === best.id) continue;
      inheritEnrichment(best, it);
      drop.add(it.id);
    }
  }
  return drop.size ? items.filter((it) => !drop.has(it.id)) : items;
}

/**
 * **販売単位だけが違う行**を1枚に畳む（同じ収集元・同じ発売日・単位表記を外すと同名）。
 *
 * 実測（2026-08-18 観点B・本人指摘の続き）: 同じページに同じ商品が2枚並ぶ組が10組あり、
 * 全部この型だった（『葬送のフリーレン Vol.2』440円 ↔ 『同 【10パック入りBOX】』4,400円 など）。
 * 発売日も商品も同じで、違うのは買う量だけ。
 *
 * **落とす側の情報は消えない。** 単位ごとの価格と購入導線は商品ページの「販売単位」欄に
 * 全部出す（`getSaleUnits`）。ここでやるのは*一覧を1枚にする*ことだけ。
 *
 * 安全弁:
 *  ・**1つでも単位表記を持つ行があること**（全部が表記なし＝同名の別記事は別の重複なので触らない）
 *  ・同じ暦日のものだけ（別日は別イベント）
 *  ・単位を外した名前が8文字以上（短い名前の偶発一致で別商品を潰さない）
 * 代表は**単位表記を持たない行**（＝商品名そのもの）を優先し、無ければ repScore で決める。
 */
function dedupeSaleUnitSameSource<T extends DedupeItem & { eventDateText?: string | null }>(items: T[]): T[] {
  const drop = new Set<number>();
  for (const g of groupSaleUnits(items, (it) => cleanListTitle(it.source, it.title))) {
    // 代表は**単位表記を持たない行**（＝商品名そのもの）を優先。同条件なら日付を持つ方＞repScore。
    const plain = g.filter((it) => !saleUnitLabel(cleanListTitle(it.source, it.title)));
    const pool = plain.length ? plain : g;
    let best = pool[0];
    for (const it of pool) {
      if (it === best) continue;
      const d =
        Number(!!it.eventDate) - Number(!!best.eventDate) || repScore(it) - repScore(best);
      if (d > 0 || (d === 0 && it.id < best.id)) best = it;
    }
    for (const it of g) {
      if (it.id === best.id) continue;
      inheritEnrichment(best, it);
      drop.add(it.id);
    }
  }
  return drop.size ? items.filter((it) => !drop.has(it.id)) : items;
}

/**
 * 商品として成立していない投稿を一覧から外す。
 * Xミラー(channeltono)には「もうすぐあみあみで復活更新があるかと…」のような、商品名を一切
 * 含まない実況投稿が混ざる。整形しても商品名が出てこない＝何が買えるか特定できないので、
 * 「特定できないなら出さない」（相場の教訓と同じ原則）に従って掲載しない。
 */
function dropNonProductPosts<T extends DedupeItem>(items: T[]): T[] {
  return items.filter((it) => hasProductSegment(it.source, it.title));
}

/**
 * 過ぎた予定を一覧から外す。
 *
 * 日付が確定していない（eventDate=null）商品でも、テキストには「2026年06月04週登場予定」の
 * ように予定が書かれていることがある。この行は日付条件に引っかからないので、**予定日が
 * 何ヶ月前でも「今後の予定」に居座り**、カードには過去日が発売日と同じ赤字で出ていた（実測69件）。
 * 日付を勝手に推定して埋める（＝こちらが精度を足す）のではなく、**過ぎた予定は載せない**。
 */
function dropStalePlans<T extends DedupeItem & { eventDateText?: string | null }>(items: T[]): T[] {
  const today = todayJst();
  return items.filter((it) => !isStalePlan(it.eventDate ?? null, it.eventDateText ?? null, today));
}

/**
 * 応募先(stores)を持つ商品の表示日を、**読んだ瞬間に today から作り直す**。
 *
 * 直す対象（2026-08-16 実測・本番で再現）: card_chusen は「店×商品」を1商品にまとめるため、
 * 1行が「143店・締切 8/15〜8/26」という*幅*を持つ。ところが eventDate には巡回した日を基準に
 * 「今日以降で最も近い締切」を**焼き付けて**いたので、翌日にはそれが過去日になり、
 * `eventDate >= today` の表示スコープから**商品ごと消えた**。まだ締切前の店が残っていても、だ。
 *
 * 実測: #75417（ONE PIECE OP-17）は今日まだ締切前の店が **102店**あるのに、トップ・/lottery・
 * /genre/トレカ・/tcg/ワンピースカード のどれにも出ていなかった（本番HTMLで不在を確認）。
 * さらに悪いことに、**スクレイプ直後は必ず正しくなる**ので、更新直後に走る audit からは
 * 永久に見えない（ミス23と同じ盲点＝"今日"に依存する値をDBに凍結した）。
 *
 * ここでの規約:
 *  ・締切が未来の枠が1つでもある → その**最短**を表示日にする（＝いちばん急ぐ日）
 *  ・そうでなければ **何もしない**。
 *
 * **ここで行を落としてはいけない。** 掲載スコープを決めるのは DB の eventDate（＝最後の締切）と
 * SQL の `eventDate >= today` であって、ここではない。全店締切済みの行はその時点で
 * SQL から外れる。一方 `/release/*` は**過去も意図して載せる**面なので、ここで落とすと
 * 月ページから過去の抽選が消える（[[System/rules]]「過去日を理由にしてよいページといけないページ」）。
 * 実装中に一度「全店締切済みなら落とす」を書いてこの穴に気付いた。
 */
function applyLiveStoreDeadline<T extends DedupeItem>(items: T[]): T[] {
  const today = todayJst();
  return items.map((it) => {
    const stores = it.stores ? parseStoresJson(it.stores) : null;
    if (!stores) return it;
    const soonest = soonestOpenDeadline(stores, today);
    const highlights = liveStoreSummary(it.highlights ?? null, stores, today);
    if (!soonest && highlights === it.highlights) return it;
    // 表示日とカード要約だけを差し替える（商品・店・条件は一切触らない）。
    return { ...it, ...(soonest ? { eventDate: soonest } : {}), highlights } as T;
  });
}

/**
 * カードの「受付中ストア：…」を、**今この瞬間に本当に受付中の店だけ**で作り直す。
 *
 * 直す対象（2026-08-16・本番のトップで確認）: この要約は巡回時に作って保存した文字列で、
 * `stores` は締切の近い順に並び、要約はその**先頭3件**を採る。つまり日が経つほど、
 * カードの見出しに出る3店はちょうど**締切が過ぎた店**になる。実際に本番のカードには
 * 「受付中ストア：…おもちゃのペリカン（抽選・8/20 00:00〜）…」と、**まだ始まっていない店**が
 * 受付中として並んでいた（詳細ページ側は前日に「（受付前）」を付けて区別済みで、
 * カードと詳細で食い違っていた）。
 *
 * **相対表記（本日/明日）はここでは作らない。** 作ると audit `frozen_relative_date` が
 * 「保存された相対日付」と区別できなくなる（あの検査は表示用の row を読む）。
 * ここでやるのは「嘘の除去」だけ＝日付は絶対表記のまま、対象を受付中の店に絞る。
 */
export function liveStoreSummary(
  highlights: string | null,
  stores: StoreEntry[],
  today: Date
): string | null {
  const PREFIX = "受付中ストア：";
  if (!highlights?.startsWith(PREFIX)) return highlights;
  const open = stores.filter((s) => {
    if (!s.at) return true; // 締切が分からない枠は落とさない（知らないことを根拠にしない）
    const at = new Date(`${s.at}T00:00:00.000Z`).getTime();
    if (s.kind === "締切") return at >= today.getTime();
    if (s.kind === "開始") return at <= today.getTime(); // まだ始まっていない店は「受付中」ではない
    return true;
  });
  if (!open.length || open.length === stores.length) return highlights;
  return `${PREFIX}${summarizeStores(open, 3)}`;
}

/**
 * 1件版（商品詳細ページ用）。表示日を today 基準に作り直すだけで、**落とさない**。
 *
 * 一覧と違い、詳細ページは直リンク・検索流入で開かれる正当な入口なので、締切が全部
 * 過ぎていても 404 にはしない（sitemap も60日は残す方針）。
 * これが無いと、同じ1ページの中で上が「抽選日 2026年8月15日(土)」＝過去、
 * 下の店舗行が「〜本日 18:00」と食い違う（2026-08-16 に本番で実際に起きていた）。
 */
export function withLiveStoreDeadline<T extends DedupeItem>(item: T, today = todayJst()): T {
  const stores = item.stores ? parseStoresJson(item.stores) : null;
  if (!stores) return item;
  const soonest = soonestOpenDeadline(stores, today);
  return soonest ? ({ ...item, eventDate: soonest } as T) : item;
}

/**
 * Xミラー（実況投稿を拾うソース）は、**日付が取れているものだけ**掲載する。
 *
 * 全1440件を通読して分かったこと: 粗はサイト全体に散っているのではなく、ここに集中していた。
 * channeltono は303件（全体の21%）あるが **93%が日付を持たない**。「いつ買えるか」を約束する
 * サイトで、5行に1行が日付未定の実況ツイート（「バンダイスピリッツ各種」「事前エントリー
 * お忘れなくどうぞ」）という状態で、これが「雑・AI臭い」という第一印象をほぼ単独で作っていた。
 * 構造化されたソース（figisland/ichiban_kuji/pokemon_goods 等）は日付なし率 0〜2% できれい。
 *
 * タイトル整形をいくら強化しても、元が実況文である以上この比率は変わらない（節分割まで
 * 作ってなお残った）。**整形で直す問題ではなく、載せる基準の問題**だった。
 * スクレイプ自体は維持する（相場・注目度の情報源としては使う）。掲載だけを絞る。
 *
 * ※ 同一ソース内のタイトル一致による自動集約は採用しない。実況タイトルは先頭が揃いやすく、
 *   実測で anemoi / ステラソラ / BanG Dream / Re:ゼロ という**別商品4件が1グループに誤集約**された。
 */
const MIRROR_SOURCES_REQUIRING_DATE = new Set(["channeltono", "rarecheck"]);

function dropUndatedMirrorPosts<T extends DedupeItem & { eventDateText?: string | null }>(items: T[]): T[] {
  return items.filter(
    (it) =>
      !MIRROR_SOURCES_REQUIRING_DATE.has(it.source) ||
      it.eventDate != null ||
      plannedDateFromText(it.eventDateText ?? null) != null
  );
}

/** 一覧に出す前の整理をまとめて適用（重複解消4種＋商品として成立していない投稿の除外）。
 *  ページごとに呼び出しが分かれると必ず適用漏れが出るので、表示用の取得は全てここを通す。 */
export function dedupeItems<T extends DedupeItem>(items: T[]): T[] {
  // applyLiveStoreDeadline を**最初**に通す。後段の dropStalePlans は eventDate を見て
  // 「過ぎた予定」を落とすので、先に表示日を today 基準へ作り直しておかないと、
  // 復活すべき行（まだ締切前の店がある商品）がそこで捨てられる。
  return dropUndatedMirrorPosts(dropStalePlans(dropNonProductPosts(
    dedupeSameSourceSameName(
      dedupeSaleUnitSameSource(
      dedupeSneakerCrossSource(
        dedupeSameSourceSameUrlContained(
          dedupeSameSourceExact(
            dedupeWordOrderCrossSource(
              dedupeCrossSource(
                dedupeSameProductUrlCrossSource(dedupeIdenticalTitle(applyLiveStoreDeadline(items)))
              )
            )
          )
        )
      )
      ),
      todayJst()
    )
  )));
}

/**
 * その行の**応募期間**（受付開始〜最後の締切）。月ページの所属を決めるのに使う。
 *
 * なぜ1点（eventDate）では足りないか（実測 2026-08-18）: 応募先(stores)を持つ行は
 * 1行が「143店・8/15〜9/2」という**幅**を持つ。DBの eventDate は**最後の締切**で、
 * 画面に出る日付は `applyLiveStoreDeadline` が today から作り直した**最短の締切**。
 * その結果、9月の月ページに「8/16」と書かれたカードが載っていた（実測3件/628件）。
 * 幅のあるものを1点として扱っている限り、どちらの月に置いても嘘になる。
 *
 * **表示日だけで絞ってはいけない**: 上の例を「表示日が8月だから8月ページへ」と動かすと、
 * 9月ページから消える一方で、8月ページのSQL（eventDate が8月）にも入らない
 * ＝**どちらの月にも出ない穴**が空く。だから所属は「**期間が月と重なるか**」で決める。
 */
export function itemPeriodMs(it: {
  eventDate: Date | string | null;
  stores?: string | null;
}): { start: number; end: number } | null {
  const days: number[] = [];
  if (it.eventDate) days.push(dayMs(it.eventDate));
  const stores = it.stores ? parseStoresJson(it.stores) : null;
  if (stores) days.push(...storeDayMs(stores));
  if (!days.length) return null;
  const end = Math.max(...days);
  // 幅は締切から遡って MAX_PERIOD_DAYS 日までに丸める。実測（2026-08-18）では
  // 期間を持つ311件のうち **296件が7日以内**で、残りのごく少数だけが3〜9ヶ月に広がる
  // ＝それは1本の抽選ではなく、**何回もの抽選をまとめたハブ記事**（応募先を溜め込んだ行）。
  // そのまま扱うと1枚のカードが9ヶ月分の月ページに並ぶ。上限は月ページのSQLが前もって
  // 見に行く範囲と同じ値にしてある（食い違うと、定義上は載るはずの行がSQLに入らない）。
  return { start: Math.max(Math.min(...days), end - MAX_PERIOD_DAYS * 86_400_000), end };
}

/**
 * 応募期間として扱う最大の幅（日）。月ページのSQLが月の後ろを見に行く日数でもある
 * （＝1つの値。ここと `getItemsByMonth` がズレると、定義と取得が食い違う）。
 */
export const MAX_PERIOD_DAYS = 62;

/** 応募期間が [start, end) と重なるか（＝その月に「応募できる日」があるか）。 */
export function overlapsRange(
  it: { eventDate: Date | string | null; stores?: string | null },
  start: Date,
  end: Date
): boolean {
  const p = itemPeriodMs(it);
  if (!p) return false;
  return p.start < end.getTime() && p.end >= start.getTime();
}

/**
 * 発売日/締切の昇順（日付なしは末尾）、同日は id 降順。SQL の orderBy と同じ規則。
 *
 * **「締切が近い順」で見せる面だけが呼ぶ。** dedupeItems の中に入れてはいけない:
 * RSS は `sort:"recent"`（新着＝id降順）で配信しており、dedupeItems が日付順に
 * 並べ直すとフィードの意味が黙って変わる（実装中に一度この形にして気付いた）。
 *
 * 呼ぶ理由: applyLiveStoreDeadline が表示日を**後ろにずらす**ことがあるため
 * （凍結された過去日 → まだ締切前の最短）、SQL が付けた順序はその行についてだけ古くなる。
 * 並べ直さないと、復活した行が「締切が近い順」の先頭に居座って嘘の緊急度を出す。
 */
export function sortByEventDate<T extends DedupeItem>(items: T[]): T[] {
  const key = (d: Date | string | null) => (d ? new Date(d).getTime() : Number.POSITIVE_INFINITY);
  return [...items].sort((a, b) => key(a.eventDate) - key(b.eventDate) || b.id - a.id);
}

// ── 検索の同義語（略称 → タイトルに実際に現れる正式表記） ─────────────────────
// ユーザーは略称で検索するが（プレースホルダの例も「ポケカ」）、タイトルは正式表記で
// 入っているため素の部分一致だと 0件になる（本番実測: ポケカ 0件↔ポケモンカード 27件、
// デュエマ 1↔19、ヒロアカ 6↔25、まどマギ 1↔22 等）。略称を含む検索は正式表記にも当てる。
// 展開は「一致を増やすだけ」なので取りこぼしを減らしても誤って絞ることはない（安全・加算的）。
const SEARCH_SYNONYMS: { alias: string; canon: string[] }[] = [
  { alias: "ポケカ", canon: ["ポケモンカード"] },
  { alias: "ワンピカード", canon: ["ワンピースカード", "one pieceカード"] },
  { alias: "ワンピ", canon: ["ワンピース"] },
  { alias: "まどマギ", canon: ["まどか☆マギカ", "魔法少女まどか"] },
  { alias: "デュエマ", canon: ["デュエル・マスターズ", "デュエルマスターズ"] },
  { alias: "ヒロアカ", canon: ["僕のヒーローアカデミア"] },
  { alias: "ぼざろ", canon: ["ぼっち・ざ・ろっく", "ぼっちざろっく"] },
  { alias: "遊戯王", canon: ["遊☆戯☆王"] },
  { alias: "プリキュア", canon: ["プリキュア"] },
  // ── ブランド名の**カタカナ↔英字**（2026-08-18・watchlist が見つけた） ─────────
  // 実測: 「アディダス」「ニューバランス」「アシックス」はどれも**表示0件**なのに、
  // 英字で引くと `new balance` 6件・`asics` 1件・`adidas` 4件（DB）が実在した。
  // 収集元（billys / snkrdunk）は商品名を英字で載せるが、**日本語話者はカタカナで検索する**。
  // つまり「載せているのに見つからない」＝在庫の問題ではなく検索の問題だった。
  // カタカナ→英字だけでなく**英字→カタカナ**も要る（両方の表記の商品が混在しているため）。
  { alias: "アディダス", canon: ["adidas"] },
  { alias: "adidas", canon: ["アディダス"] },
  { alias: "ニューバランス", canon: ["new balance", "newbalance"] },
  { alias: "new balance", canon: ["ニューバランス"] },
  { alias: "アシックス", canon: ["asics"] },
  { alias: "asics", canon: ["アシックス"] },
  { alias: "ナイキ", canon: ["nike"] },
  { alias: "nike", canon: ["ナイキ"] },
  { alias: "ジョーダン", canon: ["jordan"] },
  { alias: "jordan", canon: ["ジョーダン"] },
  { alias: "プーマ", canon: ["puma"] },
  { alias: "コンバース", canon: ["converse"] },
  { alias: "リーボック", canon: ["reebok"] },
  { alias: "ベイブレード", canon: ["beyblade"] },
  { alias: "ベアブリック", canon: ["be@rbrick", "bearbrick"] },
  // ── 英語版（/en）向け: 英語の検索語 → タイトルに実際に現れる日本語表記 ─────────
  // 展開は「一致を増やすだけ」（既存と同じ理由で安全・加算的）。作品の**公式英語名**だけを
  // 置く（こちらで訳語を作らない＝[[Projects/sedori_radar_en]] 注意点§4）。
  { alias: "pokemon", canon: ["ポケモン", "ポケモンカード"] },
  { alias: "pokémon", canon: ["ポケモン", "ポケモンカード"] },
  { alias: "one piece", canon: ["ワンピース"] },
  { alias: "gundam", canon: ["ガンダム", "ガンプラ"] },
  { alias: "gunpla", canon: ["ガンプラ"] },
  { alias: "dragon ball", canon: ["ドラゴンボール"] },
  { alias: "demon slayer", canon: ["鬼滅の刃", "鬼滅"] },
  { alias: "jujutsu kaisen", canon: ["呪術廻戦"] },
  { alias: "chainsaw man", canon: ["チェンソーマン"] },
  { alias: "hololive", canon: ["ホロライブ"] },
  { alias: "hatsune miku", canon: ["初音ミク"] },
  { alias: "ichiban kuji", canon: ["一番くじ"] },
  { alias: "my hero academia", canon: ["僕のヒーローアカデミア", "ヒロアカ"] },
  { alias: "frieren", canon: ["葬送のフリーレン", "フリーレン"] },
  { alias: "chiikawa", canon: ["ちいかわ"] },
  { alias: "evangelion", canon: ["エヴァンゲリオン", "エヴァ"] },
  { alias: "kirby", canon: ["カービィ", "星のカービィ"] },
  { alias: "sanrio", canon: ["サンリオ"] },
];

/**
 * 表記ゆれを吸収するための正規化。**不可視文字の除去 → NFKC → 小文字化** の順。
 *
 * 実測でここが検索を壊していた（表示1351件に対し取りこぼし59件）:
 *  ・プレミアムバンダイの正式表記が全角の「ＨＧ 1/144」なので「hg」で当たらない（HG30/MG18/RG7件）
 *  ・collabo_cafe のタイトルに**ゼロ幅スペース**が混入していて「ぬいぐるみ」で当たらない（3件）
 *    → 見た目は完全に正常なので、目視では絶対に見つからない類の粗。
 *  ・半角中黒の「コカ･コーラ」が「コカ・コーラ」で当たらない（1件）
 */
export function normalizeForSearch(s: string): string {
  return s.replace(INVISIBLE_CHARS, "").normalize("NFKC").toLowerCase();
}

/** タイトルが検索語に一致するか。表記ゆれを正規化し、略称(ポケカ等)は正式表記にも当てる。 */
export function matchesQuery(title: string, q: string): boolean {
  const t = normalizeForSearch(title);
  const nq = normalizeForSearch(q);
  if (t.includes(nq)) return true;
  for (const { alias, canon } of SEARCH_SYNONYMS) {
    if (nq.includes(normalizeForSearch(alias)) && canon.some((c) => t.includes(normalizeForSearch(c))))
      return true;
  }
  return false;
}

export type ClientFilter = {
  genre?: string;
  query?: string;
  status?: ItemStatus;
  when?: ItemWhen;
  datedOnly?: boolean;
};

type FilterableItem = {
  genre: string;
  title: string;
  eventType: string;
  eventDate: Date | string | null;
  // どちらかがあればよい。ブラウザ側で動く絞り込みは `lottery`（事前計算）を使う。
  source?: string;
  lottery?: boolean;
};

const DAY = 24 * 60 * 60 * 1000;

/** 暦日(UTC0時)のミリ秒に正規化（保存値の時刻ゆらぎを無視） */
function dayMs(d: Date | string): number {
  const x = new Date(d);
  return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
}

/**
 * ブラウザ側で使う絞り込み。サーバーの getItems（Prisma版）と同じ意味論。
 * 入力の items は既に「今後の予定＋日付未定（過去は除外）」に絞られている前提。
 */
export function filterItems<T extends FilterableItem>(items: T[], f: ClientFilter): T[] {
  const today = todayJst();
  const t0 = today.getTime();
  const dow = today.getUTCDay(); // 0=日
  const nextMon = t0 + ((((8 - dow) % 7) || 7) * DAY); // 来週月曜0時（今週末まで）
  const nextMonth = Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1); // 翌月1日0時
  const q = f.query?.trim().toLowerCase();

  return items.filter((it) => {
    if (f.genre && it.genre !== f.genre) return false;
    if (q && !matchesQuery(it.title, q)) return false;

    if (f.status === "now") {
      // 「いま買える」速報＝日付なし かつ 予定品(登場予定/開催)でないもの。期間条件は課さない。
      if (it.eventDate !== null) return false;
      return !TBD_EVENT_TYPES.includes(it.eventType);
    }
    if (f.status === "lottery") {
      // 抽選判定は共有述語に集約（snkrdunk の定型ラベル誤混入を除外）
      if (!isLotteryItem(it)) return false;
    } else if (f.status === "reserve" || f.status === "release") {
      if (!STATUS_EVENT_TYPES[f.status].includes(it.eventType)) return false;
    }

    // 期間（種別=速報のときは上で return 済み）
    if (f.when) {
      if (it.eventDate === null) return false; // 未定は範囲に入らない
      const ms = dayMs(it.eventDate);
      return f.when === "week" ? ms >= t0 && ms < nextMon : ms >= t0 && ms < nextMonth;
    }
    if (f.datedOnly && it.eventDate === null) return false; // 「日付未定を隠す」
    return true;
  });
}

/** 発売日順のアイテムを「今日/明日/今週/それ以降/日付未定」に分けて見出し表示しやすくする */
export function groupItemsByDate<T extends { eventDate: Date | string | null }>(
  items: T[]
): { label: string; items: T[] }[] {
  const today = todayJst();
  const t0 = today.getTime();
  const tomorrow = t0 + DAY;
  const dayAfter = t0 + 2 * DAY;
  const dow = today.getUTCDay();
  const nextMon = t0 + ((((8 - dow) % 7) || 7) * DAY);

  const buckets: Record<string, T[]> = {
    今日: [],
    明日: [],
    今週: [],
    それ以降: [],
    日付未定: [],
  };
  for (const it of items) {
    if (!it.eventDate) {
      buckets["日付未定"].push(it);
      continue;
    }
    const ms = dayMs(it.eventDate);
    if (ms < tomorrow) buckets["今日"].push(it);
    else if (ms < dayAfter) buckets["明日"].push(it);
    else if (ms < nextMon) buckets["今週"].push(it);
    else buckets["それ以降"].push(it);
  }
  return Object.entries(buckets)
    .filter(([, arr]) => arr.length > 0)
    .map(([label, arr]) => ({ label, items: arr }));
}
