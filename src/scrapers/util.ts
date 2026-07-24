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
  return calDate(Number(y), Number(mo), Number(d));
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

/** "7月6日" (no year) -> resolves to nearest future/past-tolerant year */
export function resolveMonthDay(month: number, day: number, reference = new Date()): Date {
  let year = reference.getUTCFullYear();
  const guess = calDate(year, month, day);
  const sixtyDaysMs = 60 * 24 * 60 * 60 * 1000;
  if (guess.getTime() < reference.getTime() - sixtyDaysMs) {
    year += 1;
  }
  return calDate(year, month, day);
}

/** Extract first "N月N日" occurrence + optional event-type keyword from free text */
export function extractDateAndEventFromText(
  text: string
): { date: Date | null; eventType: string | null; dateText: string | null } {
  const dateMatch = text.match(/(\d{1,2})月(\d{1,2})日(?:\([月火水木金土日]\))?(?:\s*(\d{1,2})時)?/);
  const eventMatch = text.match(/(予約開始|抽選|受付開始|販売開始|発売開始|発売|値下げ|再販|再登場)/);
  if (!dateMatch) {
    return { date: null, eventType: eventMatch ? eventMatch[1] : null, dateText: null };
  }
  const month = Number(dateMatch[1]);
  const day = Number(dateMatch[2]);
  return {
    date: resolveMonthDay(month, day),
    eventType: eventMatch ? eventMatch[1] : null,
    dateText: dateMatch[0],
  };
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
  if (/ゲーム|game|switch|playstation|quest|meta/i.test(t)) return "ゲーム";
  return "その他";
}
