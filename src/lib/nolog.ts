/**
 * 「この訪問を数えない」判定（純関数だけ・DOM非依存）。
 *
 * 由来（2026-08-19 実測）: 直近30日の**日本385PVのうち347PV(90%)が Windows デスクトップ**＝
 * 自分の作業と検証ブラウザだった。さらに Turso の Event を時刻順に並べたら、
 * **1分間に14ジャンル全部を踏む**・**同一商品へ3連打**といった人間ではない形が並び、
 * 「outbound_click 28件＝収益導線」という読みを丸ごと取り下げる羽目になった（System/mistakes ミス33）。
 * 計測している本人が最大のノイズ源なので、**入口で落とす**。
 *
 * ここを純関数にしてあるのは、**入れた日に一度も確かめられない**のを避けるため
 * （本物で確かめるには自分のブラウザで踏むしかなく、踏んだ時点で結果が消える）。
 * 鳴る側・鳴らない側を合成入力で `audit:selftest` に固定する。
 *
 * 落とす対象は3種類:
 *   1. **自動操作/内蔵ブラウザ**（Claude Code の内蔵ブラウザ・ヘッドレス・各種ドライバ）… UAで自動判定
 *   2. **本人**… `?nolog=1` を一度踏むと localStorage に印が残り、以後そのブラウザは数えない
 *   3. **本番以外**… localhost とプレビュー配信（*.vercel.app）
 */

/** 一度踏むと以後そのブラウザを数えなくする URL パラメータ。`?nolog=0` で解除。 */
export const NOLOG_PARAM = "nolog";

/** 除外の印を置く localStorage のキー。 */
export const NOLOG_STORAGE_KEY = "hatsukore:nolog";

/**
 * 除外を**始めた瞬間だけ**残す足跡の Event 名。
 *
 * これが無いと、`?nolog=1` の付いたURLが外に漏れた日に
 * **本物の読者が黙って計測から消える**（＝数字が減ったことにしか気付けない）。
 * 除外ブラウザが増えたら件数で見えるようにしておく。
 */
export const NOLOG_OPTOUT_EVENT = "nolog_optout";

/**
 * 自分たちの道具の印。**実測で確かめた文字列だけ**を入れる（推測で足すと本物の読者を消す）。
 * - `Claude/` と `Electron/` … Claude Code の内蔵ブラウザ。2026-08-19 に実UAで確認:
 *   `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ... Claude/1.32352.1 Chrome/148 Electron/42.9.2 ... MSIX`
 *   ※ このブラウザは `navigator.webdriver` が **false** なので、webdriver だけでは落ちない（実測）。
 */
const AUTOMATION_MARKERS = [
  "claude/",
  "electron/",
  "headless",
  "playwright",
  "puppeteer",
  "selenium",
  "webdriver",
  "cypress",
  "lighthouse",
];

/** 巡回の印（人間ではないが自分たちの道具でもない）。/api/track が元から見ていたもの。 */
const CRAWLER_MARKERS = ["bot", "crawl", "spider", "slurp", "bingpreview", "preview"];

/** 自分たちの道具（自動操作・内蔵ブラウザ）か。 */
export function isAutomationUserAgent(ua: string): boolean {
  const s = ua.toLowerCase();
  return AUTOMATION_MARKERS.some((m) => s.includes(m));
}

/** 巡回か。 */
export function isCrawlerUserAgent(ua: string): boolean {
  const s = ua.toLowerCase();
  return CRAWLER_MARKERS.some((m) => s.includes(m));
}

/** 人間の閲覧として数えてよい UA か（＝巡回でも自分たちの道具でもない）。 */
export function isCountableUserAgent(ua: string): boolean {
  return !isAutomationUserAgent(ua) && !isCrawlerUserAgent(ua);
}

/** 本番の配信面か（localhost とプレビューは数えない）。 */
export function isProductionHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]") return false;
  // `app.localhost` のようなサブドメインも開発機。完全一致だけ見ると素通りする。
  if (h.endsWith(".localhost") || h.endsWith(".local")) return false;
  // プレビュー配信。本番ドメインへ 308 で送っているので、ここで描画される実訪問は無い。
  if (h.endsWith(".vercel.app")) return false;
  return true;
}

/** URL から `?nolog=` の指定を読む。付いていなければ null。 */
export function readNologParam(href: string): "on" | "off" | null {
  let value: string | null = null;
  try {
    value = new URL(href).searchParams.get(NOLOG_PARAM);
  } catch {
    return null;
  }
  if (value === null) return null;
  const v = value.trim().toLowerCase();
  if (v === "0" || v === "off" || v === "false") return "off";
  // 空の `?nolog` も「除外して」と読む（打ち間違いで無言で有効にならない方が良い）。
  return "on";
}

export type VisitSignals = {
  userAgent: string;
  /** location.href 相当 */
  href: string;
  hostname: string;
  /** localStorage に保存済みの印。読めない環境（プライベートモード等）では null */
  storedFlag: string | null;
};

export type NologDecision = {
  /** この訪問を記録しないなら true */
  skip: boolean;
  /** localStorage の印をどうするか。null なら触らない */
  store: "set" | "clear" | null;
  /** なぜ落としたか（画面には出さない・検査と調査のため） */
  reason: "automation" | "crawler" | "non-production" | "opt-out-now" | "opted-out" | null;
};

/**
 * この訪問を記録するかどうかを決める。**判定順に意味がある。**
 *
 * 自動操作と本番以外を先に見るのは、`?nolog=0`（解除）で
 * **自分の検証ブラウザを数え始められる抜け道を作らない**ため。
 */
export function decideNolog(s: VisitSignals): NologDecision {
  if (isAutomationUserAgent(s.userAgent)) return { skip: true, store: null, reason: "automation" };
  if (isCrawlerUserAgent(s.userAgent)) return { skip: true, store: null, reason: "crawler" };
  if (!isProductionHostname(s.hostname)) {
    return { skip: true, store: null, reason: "non-production" };
  }
  const param = readNologParam(s.href);
  if (param === "on") return { skip: true, store: "set", reason: "opt-out-now" };
  if (param === "off") return { skip: false, store: "clear", reason: null };
  if (s.storedFlag === "1") return { skip: true, store: null, reason: "opted-out" };
  return { skip: false, store: null, reason: null };
}

/**
 * いまのブラウザの判定。**window が無い場合は「記録しない」**側に倒す
 * （サーバ側で誤って数え始めるより、落ちている方が読める数字になる）。
 */
export function currentNologDecision(): NologDecision {
  if (typeof window === "undefined") {
    return { skip: true, store: null, reason: "non-production" };
  }
  let storedFlag: string | null = null;
  try {
    storedFlag = window.localStorage.getItem(NOLOG_STORAGE_KEY);
  } catch {
    // プライベートモード等で読めない場合は印なし扱い（読めないことを理由に消さない）。
  }
  return decideNolog({
    userAgent: window.navigator.userAgent,
    href: window.location.href,
    hostname: window.location.hostname,
    storedFlag,
  });
}

/** 判定に従って localStorage の印を更新し、「いま除外を始めた」なら true を返す。 */
export function applyNologDecision(d: NologDecision): boolean {
  if (typeof window === "undefined" || d.store === null) return false;
  try {
    if (d.store === "clear") {
      window.localStorage.removeItem(NOLOG_STORAGE_KEY);
      return false;
    }
    const already = window.localStorage.getItem(NOLOG_STORAGE_KEY) === "1";
    window.localStorage.setItem(NOLOG_STORAGE_KEY, "1");
    return !already;
  } catch {
    return false;
  }
}
