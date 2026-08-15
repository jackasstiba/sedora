// X（旧Twitter）巡回で拾った「転売に良さそうな商品／実売相場」をハツコレに取り込む純関数群。
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
import { matchFranchises, franchiseAliases } from "./franchise";
import type { ScrapedItem } from "../scrapers/types";
import { nowInstant } from "./date";

export const X_WATCH_SOURCE = "x_watch";
export const X_MARKET_SOURCE = "x"; // 相場の出所（メルカリ等の実売をXで確認したもの）

/** 巡回で拾った1件。kind で「新規商品」か「既存への相場付与」かを分ける。 */
export type XWatchEntry = {
  kind: "new" | "resale";

  // --- kind:"new"（新規商品としてハツコレに追加） ---
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
export function buildMarketFields(entry: XWatchEntry, now: Date = nowInstant()): MarketFields {
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
export function toScrapedItem(entry: XWatchEntry, now: Date = nowInstant()): ScrapedItem & MarketFields {
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
    subGenre: null, // 収集元は非公開方針。由来ハンドル(@xxx)はDB・表示に載せない（note は運用ログのみ）
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

// ── 型番・作品を使った強いマッチング ────────────────────────────────────────
// 素の2-gram類似度だけだと、Xの略称（ポケカ↔ポケモンカード）や語順・告知文ノイズで
// 同一商品を取りこぼす。TCG等の型番（GD05等）と作品名（franchise辞書）を結合キーに足す。

// 型番として扱わない汎用の英字接頭辞（VOL2/PART1 等で別商品を誤結合しないため）。
const GENERIC_CODE_PREFIX = new Set(["VOL", "PART", "NO", "CH", "EP", "VER", "TYPE", "ROUND", "SET"]);

/**
 * タイトルから商品コード/型番（英字＋数字）を抽出する。例: GD05, OP11, OP-11, SV8A, EB01。
 * 同一商品を強く示す結合キー。単独数字や汎用語（VOL2 等）は scoreMatch 側で弾く。
 */
export function extractModelCodes(title: string): string[] {
  const t = title.normalize("NFKC").toUpperCase();
  const out = new Set<string>();
  for (const m of t.matchAll(/([A-Z]{1,4})-?(\d{1,3})([A-Z]{0,2})/g)) {
    const code = `${m[1]}${m[2]}${m[3]}`;
    if (code.length >= 3 && /\d/.test(code)) out.add(code);
  }
  return [...out];
}

/** 別商品の誤結合を避けた「本物らしい型番」だけ（英字部2文字以上＋非汎用）。 */
function realModelCodes(title: string): Set<string> {
  const out = new Set<string>();
  for (const c of extractModelCodes(title)) {
    const alpha = c.match(/^[A-Z]+/)?.[0] ?? "";
    if (alpha.length >= 2 && !GENERIC_CODE_PREFIX.has(alpha)) out.add(c);
  }
  return out;
}

function franchiseNames(title: string): Set<string> {
  return new Set(matchFranchises(title).map((g) => g[0]));
}

function hasIntersection<T>(a: Set<T>, b: Set<T>): boolean {
  for (const x of a) if (b.has(x)) return true;
  return false;
}

/**
 * 候補DBを絞り込むための「特徴トークン」。型番＋作品名＋最長の内容語。
 * これらのいずれかを含むアイテムを候補に引くことで、先頭6文字だけの脆い前段フィルタで
 * 候補ゼロになり誤って新規化（＝重複発生）するのを防ぐ。
 */
export function distinctiveTokens(title: string): string[] {
  const set = new Set<string>();
  for (const c of realModelCodes(title)) set.add(c);
  for (const f of franchiseNames(title)) set.add(f);
  const chunks = title
    .normalize("NFKC")
    .replace(/[!-/:-@[-`{-~、。・「」『』【】（）〈〉！？…]/g, " ")
    .split(/[\s　]+/)
    .filter((w) => w.length >= 3);
  const longest = chunks.sort((a, b) => b.length - a.length)[0];
  if (longest) set.add(longest);
  return [...set];
}

// パッケージ・商品形態を表す汎用語。作品残差を取るとき除去する（同一作品の別商品を
// 見分けるのは作品名でもパック種別でもなく「サブタイトル/賞/弾番号」なので、そこを残す）。
const GENERIC_WORDS = [
  "強化拡張パック", "拡張パック", "ブースターパック", "プロモーションパック", "スターターデッキ",
  "コレクションボックス", "カードゲーム", "一番くじ", "ボックス", "デッキ", "パック", "セット", "tcg", "ゲーム",
];

/** タイトルから作品名・パッケージ語を除いた「識別部（サブタイトル/弾/賞）」を正規化して返す。 */
export function residual(title: string): string {
  let t = title.normalize("NFKC").toLowerCase();
  for (const alias of franchiseAliases(title)) t = t.split(alias.toLowerCase()).join(" ");
  for (const w of GENERIC_WORDS) t = t.split(w.toLowerCase()).join(" ");
  return normalizeTitle(t);
}

/**
 * 2つのタイトルが同一商品を指す確からしさ（0..1目安）。
 * ① 型番が両方にあり食い違う → 別商品(GD05≠GD04)として低く抑える／一致すれば同一商品＝強い。
 * ② それ以外で作品が一致 → 作品名を除いた識別部(残差)の類似度で判定（同一作品の別くじ/別弾を
 *    共通接頭辞の見かけの高スコアで誤結合しないため）。
 * ③ 作品も型番も手掛かりが無い → 素の2-gram類似度。
 */
export function scoreMatch(a: string, b: string): number {
  const ca = realModelCodes(a);
  const cb = realModelCodes(b);
  if (ca.size && cb.size) {
    return hasIntersection(ca, cb) ? Math.max(similarity(a, b), 0.85) : Math.min(similarity(a, b), 0.35);
  }
  const base = similarity(a, b);
  if (hasIntersection(franchiseNames(a), franchiseNames(b))) {
    const ra = residual(a);
    const rb = residual(b);
    if (ra.length >= 2 && rb.length >= 2) return similarity(ra, rb); // 識別部で判定
    return base; // 残差が取れない（作品名だけ等）→ 素の類似度
  }
  return base;
}

export type MatchCandidate = { id: number; title: string };

/**
 * match 文字列に最も近い候補を返す（scoreMatch がしきい値以上のときだけ）。
 * 誤って無関係な既存アイテムに高額相場を貼るのを防ぐため、既定しきい値は高め(0.5)。
 */
export function pickBestMatch(
  match: string,
  candidates: MatchCandidate[],
  threshold = 0.5
): { id: number; title: string; score: number } | null {
  let best: { id: number; title: string; score: number } | null = null;
  for (const c of candidates) {
    const score = scoreMatch(match, c.title);
    if (!best || score > best.score) best = { id: c.id, title: c.title, score };
  }
  return best && best.score >= threshold ? best : null;
}
