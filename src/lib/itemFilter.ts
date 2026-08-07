// サーバー(Prisma)とクライアント(ブラウザ内フィルタ)で共有する、絞り込みの純粋ロジック。
// prisma を import しないこと（クライアントバンドルに載せるため）。
import { isStalePlan, todayJst } from "./date";
import { parseYen } from "./margin";
import { cleanListTitle, hasProductSegment } from "./title";

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
  "コラボ",
  "ポケモン",
  "ソフビ・アートトイ",
  "家電・ゲーム機",
  "酒・ウイスキー",
  "映像・音楽",
  "その他",
];

// バラバラな eventType 文字列を、せどり視点の3グループに正規化する。
export const STATUS_EVENT_TYPES: Record<Exclude<ItemStatus, "now">, string[]> = {
  reserve: ["予約開始", "予約受付中", "受付開始"],
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
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
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
  source: string;
  hasLottery?: boolean | null;
}): boolean {
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
  if (!keep.hasLottery && from.hasLottery) keep.hasLottery = from.hasLottery;
  if (!keep.highlights && from.highlights) keep.highlights = from.highlights;
}

/** 重複判定用のタイトル正規化（記号・空白除去、全角半角/大小の吸収）。
 *  例: 「ワンピース Grandista-LUFFY-」→ "ワンピースgrandistaluffy"
 *  引用符（"" '' “” ‘’ 〝〟）も除去する。同一商品を figisland が“レゼ”、koretore が
 *  ‐レゼ‐ のように別の括り記号で載せると別キーになり重複が残っていたため。 */
export function dedupeKey(title: string): string {
  return title
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
  const groups = new Map<string, T[]>();
  for (const it of items) {
    const day = it.eventDate ? dayISO(it.eventDate) : "none";
    const k = `${it.source}|${it.title}|${day}`;
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

/** 一覧に出す前の整理をまとめて適用（重複解消4種＋商品として成立していない投稿の除外）。
 *  ページごとに呼び出しが分かれると必ず適用漏れが出るので、表示用の取得は全てここを通す。 */
export function dedupeItems<T extends DedupeItem>(items: T[]): T[] {
  return dropStalePlans(dropNonProductPosts(
    dedupeSneakerCrossSource(
      dedupeSameSourceExact(
        dedupeWordOrderCrossSource(dedupeCrossSource(dedupeIdenticalTitle(items)))
      )
    )
  ));
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
];

/** タイトルが検索語に一致するか。素の部分一致に加え、略称(ポケカ等)は正式表記にも当てる。 */
export function matchesQuery(title: string, q: string): boolean {
  const t = title.toLowerCase();
  if (t.includes(q)) return true;
  for (const { alias, canon } of SEARCH_SYNONYMS) {
    if (q.includes(alias) && canon.some((c) => t.includes(c.toLowerCase()))) return true;
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
  source: string;
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
