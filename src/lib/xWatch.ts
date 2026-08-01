// X（旧Twitter）巡回で拾った「転売に良さそうな商品／実売相場」をレアレーダーに取り込む純関数群。
// prisma を import しないこと（ロジックを単体で検証可能に保つ）。
//
// 背景と方針:
//  - X本体は自動スクレイプが困難なため、Claude for Chrome（ログイン済み実Chrome）で
//    相場発信アカウント（@otakarasan9 / @mercariKING / @kuji_dachs 等）を定期巡回し、
//    人手＋AIで構造化した結果を「受け皿JSON（x_watch_inbox.json）」に落とす。
//  - このモジュールはそのJSONエントリを (a) 新規商品 と (b) 既存アイテムへの相場付与 に振り分け、
//    DB書き込み用の値へ正規化する。X転売の肝である「実売相場（メルカリ○万）」を market* 列に載せる。
//  - marketSource="x" で駿河屋中古相場（marketSource="surugaya"）と区別する。

import { classifyGenre, extractDateAndEventFromText } from "../scrapers/util";
import type { ScrapedItem } from "../scrapers/types";

export const X_WATCH_SOURCE = "x_watch";
export const X_MARKET_SOURCE = "x"; // 相場の出所（メルカリ等の実売をXで確認したもの）

/** 巡回で拾った1件。kind で「新規商品」か「既存への相場付与」かを分ける。 */
export type XWatchEntry = {
  kind: "new" | "resale";

  // --- kind:"new"（新規商品としてレアレーダーに追加） ---
  title?: string;
  genre?: string | null; // 明示指定（省略時は classifyGenre）
  eventType?: string | null; // 予約/抽選/発売/開催/再販 等（省略時は本文から推定→"情報"）
  eventDate?: string | null; // ISO日付（省略時は eventDateText/title から推定）
  eventDateText?: string | null;
  price?: string | null; // 定価（分かれば）
  url?: string | null; // 一次情報（公式/商品ページ）。無ければ出典Xポスト
  imageUrl?: string | null;
  lottery?: boolean | null; // 抽選/ランダム性がある

  // --- kind:"resale"（既存アイテムに相場を付与）。itemId 優先、無ければ match で曖昧一致 ---
  itemId?: number | null;
  match?: string | null; // 対象商品名（曖昧マッチ用）

  // --- 相場（両kind共通・任意） ---
  resaleYen?: number | null; // X上で確認した実売相場（円・整数）
  resaleText?: string | null; // 表示ラベル素（例: "メルカリ 毎回20万前後"）
  resaleUrl?: string | null; // 相場の出典（Xポスト/メルカリ検索URL 等）

  note?: string | null; // 由来メモ（@ハンドル等。DBには載せない運用ログ用）
};

export type XWatchInbox = {
  sweptAt?: string;
  entries: XWatchEntry[];
};

/** market* 列にセットする相場情報。resaleYen が無ければ null（相場は付けない）。 */
export type MarketFields = {
  marketPrice: number | null;
  marketPriceText: string | null;
  marketUrl: string | null;
  marketSource: string | null;
  marketCheckedAt: Date;
};

/** 表示ラベルを「メルカリ ¥N」の形へ寄せる。resaleText があれば尊重しつつ円記号を整える。 */
export function formatResaleText(entry: XWatchEntry): string | null {
  if (entry.resaleText && entry.resaleText.trim()) return entry.resaleText.trim();
  if (entry.resaleYen && entry.resaleYen > 0) {
    return `メルカリ ¥${entry.resaleYen.toLocaleString("ja-JP")}`;
  }
  return null;
}

/** エントリから market* 用フィールドを組み立てる。相場が無ければ全 null（marketCheckedAt のみ現時刻）。 */
export function buildMarketFields(entry: XWatchEntry, now: Date = new Date()): MarketFields {
  const text = formatResaleText(entry);
  const yen = entry.resaleYen && entry.resaleYen > 0 ? Math.round(entry.resaleYen) : null;
  return {
    marketPrice: yen,
    marketPriceText: text,
    marketUrl: entry.resaleUrl ?? null,
    marketSource: text ? X_MARKET_SOURCE : null,
    marketCheckedAt: now,
  };
}

/** 新規商品の安定 sourceId（upsert 冪等性のため）。URLがあればそれ、無ければ正規化タイトル。 */
export function xWatchSourceId(entry: XWatchEntry): string {
  if (entry.url && entry.url.trim()) return entry.url.trim().slice(0, 300);
  return `t:${normalizeTitle(entry.title ?? "")}`.slice(0, 300);
}

/** kind:"new" のエントリを ScrapedItem（source=x_watch）へ変換。相場は market* に載る。 */
export function toScrapedItem(entry: XWatchEntry, now: Date = new Date()): ScrapedItem & MarketFields {
  const title = (entry.title ?? "").trim();
  const inferred = extractDateAndEventFromText(`${title} ${entry.eventDateText ?? ""}`.trim());
  const eventDate = entry.eventDate ? new Date(entry.eventDate) : inferred.date;
  const genre = entry.genre && entry.genre.trim() ? entry.genre.trim() : classifyGenre(title);
  const market = buildMarketFields(entry, now);
  return {
    source: X_WATCH_SOURCE,
    sourceId: xWatchSourceId(entry),
    title,
    genre,
    subGenre: entry.note?.match(/@[\w]+/)?.[0] ?? null, // 由来ハンドルを控えめに保持
    eventType: entry.eventType?.trim() || inferred.eventType || "情報",
    eventDate,
    eventDateText: entry.eventDateText ?? inferred.dateText ?? null,
    price: entry.price ?? null,
    url: (entry.url ?? entry.resaleUrl ?? "").trim(),
    imageUrl: entry.imageUrl ?? null,
    hasLottery: entry.lottery ?? null,
    highlights: null,
    officialUrl: null,
    ...market,
  };
}

// ── 曖昧マッチ（kind:"resale" で既存アイテムを探す） ──────────────────────────
// 全角→半角・記号除去で正規化し、2-gram の Dice 係数で類似度を測る。
// surugayaPrice の誤マッチ防止と同じ発想（フリーテキスト由来の誤爆を弾く）。

export function normalizeTitle(s: string): string {
  return s
    .normalize("NFKC") // 全角英数記号→半角
    .toLowerCase()
    .replace(/[\s　]+/g, "")
    .replace(/[!-/:-@[-`{-~、。・「」『』【】（）〈〉！？…ー-]/g, "");
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** 2-gram Dice 係数（0〜1）。短すぎる語は完全一致判定にフォールバック。 */
export function similarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na.length < 2 || nb.length < 2) return na === nb ? 1 : 0;
  const ga = bigrams(na);
  const gb = bigrams(nb);
  let inter = 0;
  for (const [g, c] of ga) {
    const c2 = gb.get(g);
    if (c2) inter += Math.min(c, c2);
  }
  const total = [...ga.values()].reduce((a2, b2) => a2 + b2, 0) + [...gb.values()].reduce((a2, b2) => a2 + b2, 0);
  return total === 0 ? 0 : (2 * inter) / total;
}

export type MatchCandidate = { id: number; title: string };

/**
 * match 文字列に最も近い候補を返す（類似度がしきい値以上のときだけ）。
 * 誤って無関係な既存アイテムに高額相場を貼るのを防ぐため、既定しきい値は高め(0.5)。
 */
export function pickBestMatch(
  match: string,
  candidates: MatchCandidate[],
  threshold = 0.5
): { id: number; title: string; score: number } | null {
  let best: { id: number; title: string; score: number } | null = null;
  for (const c of candidates) {
    const score = similarity(match, c.title);
    if (!best || score > best.score) best = { id: c.id, title: c.title, score };
  }
  return best && best.score >= threshold ? best : null;
}
