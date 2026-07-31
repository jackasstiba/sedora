// サーバー(Prisma)とクライアント(ブラウザ内フィルタ)で共有する、絞り込みの純粋ロジック。
// prisma を import しないこと（クライアントバンドルに載せるため）。
import { todayJst } from "./date";

export type ItemStatus = "reserve" | "lottery" | "release" | "now";
export type ItemWhen = "week" | "month";

// 日付なしのうち「日程未定の予定品」を表す eventType（＝いま買えるわけではない）。
export const TBD_EVENT_TYPES = ["登場予定", "開催"];

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
}): boolean {
  if (it.eventType === "抽選") return true;
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
};

/** 重複判定用のタイトル正規化（記号・空白除去、全角半角/大小の吸収）。
 *  例: 「ワンピース Grandista-LUFFY-」→ "ワンピースgrandistaluffy" */
function dedupeKey(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　]+/g, "")
    .replace(/[-‐-―ー－_,.、。!！?？「」『』【】\[\]()（）:：/／|｜~〜]/g, "");
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
    const k = dedupeKey(it.title);
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
    for (const it of g) if (it.id !== best.id) drop.add(it.id);
  }
  return drop.size ? items.filter((it) => !drop.has(it.id)) : items;
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
    if (q && !it.title.toLowerCase().includes(q)) return false;

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
