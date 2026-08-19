import crypto from "node:crypto";
import { nowInstant } from "./date";

// X (Twitter) API v2 への投稿クライアント。
// 認証は OAuth 1.0a User Context（単一アカウントのbot用途では OAuth 2.0 PKCE より
// 単純＝ブラウザでの認可フローもリフレッシュも要らず、4つの固定キーだけで完結する）。
// 依存を増やさないため署名は node:crypto で自前実装している。

const API_BASE = "https://api.x.com";

export type XCreds = {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
};

const ENV_KEYS = ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"] as const;

/** .env から資格情報を読む。値そのものは絶対にログへ出さない（欠けている変数名だけ知らせる）。 */
export function loadCreds(): XCreds {
  const missing = ENV_KEYS.filter((k) => !process.env[k]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `X の資格情報が .env にありません: ${missing.join(", ")}\n` +
        `developer.x.com のアプリ設定 → Keys and tokens から取得して .env に追記してください。`,
    );
  }
  return {
    apiKey: process.env.X_API_KEY!.trim(),
    apiSecret: process.env.X_API_SECRET!.trim(),
    accessToken: process.env.X_ACCESS_TOKEN!.trim(),
    accessSecret: process.env.X_ACCESS_SECRET!.trim(),
  };
}

/** RFC3986 のパーセントエンコード。encodeURIComponent が残す !'()* も潰す必要がある。 */
function enc(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

/**
 * OAuth 1.0a の Authorization ヘッダを組む。
 * ボディが JSON の場合、署名の base string にボディは含めない（仕様上、含めるのは
 * application/x-www-form-urlencoded のときだけ）。ここを含めると必ず 401 になる。
 */
function authHeader(method: string, fullUrl: string, creds: XCreds): string {
  const [url, query = ""] = fullUrl.split("?");
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(nowInstant().getTime() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };

  // 署名対象は oauth_* とクエリ文字列の合算をキー順に並べたもの
  const all: [string, string][] = Object.entries(oauth);
  for (const pair of query ? query.split("&") : []) {
    const [k, v = ""] = pair.split("=");
    if (k) all.push([decodeURIComponent(k), decodeURIComponent(v)]);
  }
  const paramStr = all
    .map(([k, v]) => [enc(k), enc(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const base = [method.toUpperCase(), enc(url), enc(paramStr)].join("&");
  const signingKey = `${enc(creds.apiSecret)}&${enc(creds.accessSecret)}`;
  oauth.oauth_signature = crypto.createHmac("sha1", signingKey).update(base).digest("base64");

  return (
    "OAuth " +
    Object.keys(oauth)
      .sort()
      .map((k) => `${enc(k)}="${enc(oauth[k])}"`)
      .join(", ")
  );
}

/**
 * X の「重み付き文字数」。上限は 280 だが CJK は 1文字=2 で数えられるため
 * 日本語だと実質 140 字。URL は実長に関わらず一律 23。
 * 投げてから 403 で弾かれるのを避けるため送信前に自前で数える。
 */
const URL_RE = /https?:\/\/\S+/g;
const URL_WEIGHT = 23;
export const MAX_WEIGHTED = 280;

function isLightChar(cp: number): boolean {
  return (
    (cp >= 0x0000 && cp <= 0x10ff) ||
    (cp >= 0x2000 && cp <= 0x200d) ||
    (cp >= 0x2010 && cp <= 0x201f) ||
    (cp >= 0x2032 && cp <= 0x2037)
  );
}

export function weightedLength(text: string): number {
  const urls = text.match(URL_RE) ?? [];
  let total = urls.length * URL_WEIGHT;
  for (const ch of text.replace(URL_RE, "")) {
    total += isLightChar(ch.codePointAt(0)!) ? 1 : 2;
  }
  return total;
}

/** X API のレスポンス外形。成功時は data、失敗時は detail/title/errors が入る。 */
type XApiResponse<T> = {
  data?: T;
  detail?: string;
  title?: string;
  errors?: { message?: string }[];
};

async function call<T>(method: string, path: string, creds: XCreds, body?: unknown): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: authHeader(method, url, creds),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await res.text();
  let json: XApiResponse<T> | null = null;
  try {
    json = JSON.parse(text) as XApiResponse<T>;
  } catch {
    /* HTMLのエラーページ等。生テキストを下で見せる */
  }

  if (!res.ok) {
    const detail = json?.detail ?? json?.title ?? json?.errors?.[0]?.message ?? text.slice(0, 300);
    // 一番踏みやすい罠を名指しで案内する。アプリ権限を Read and Write に変えても
    // Access Token を再生成しないと、古いトークンは read-only のまま残る。
    const hint =
      res.status === 403
        ? "\nヒント: アプリ権限を Read and Write にした後、Access Token と Secret を" +
          "**再生成**しましたか？ 権限変更前に発行したトークンは read-only のままです。"
        : res.status === 401
          ? "\nヒント: 4つのキーの取り違え・前後の空白・改行混入を確認してください。"
          : res.status === 429
            ? "\nヒント: 無料枠の投稿上限に当たっています。開発者ポータルの Usage で残量を確認してください。"
            : res.status === 402
              ? "\nヒント: **投稿はクレジットを消費します**（2026-08-19 実測。読み取りは残高$0でも通るが" +
                "POST /2/tweets は 402 credits depleted で弾かれる）。開発者ポータルの Billing で" +
                "支払い方法を登録し、クレジットを買う必要があります。**本人操作**。"
              : "";
    throw new Error(`X API ${method} ${path} が ${res.status} で失敗: ${detail}${hint}`);
  }
  if (json?.data === undefined) throw new Error(`X API ${path} の応答に data がありません: ${text.slice(0, 300)}`);
  return json.data;
}

/** 資格情報の疎通確認。投稿はしない。 */
export async function verifyCredentials(creds: XCreds): Promise<{ id: string; username: string; name: string }> {
  return await call<{ id: string; username: string; name: string }>("GET", "/2/users/me", creds);
}

/** 実際に投稿する。呼ぶ前に必ず本人の明示的な了承を取ること。 */
export async function postTweet(text: string, creds: XCreds): Promise<{ id: string; text: string }> {
  const len = weightedLength(text);
  if (len > MAX_WEIGHTED) {
    throw new Error(`重み付き文字数が上限超過: ${len} / ${MAX_WEIGHTED}（日本語は1文字=2、URLは一律23）`);
  }
  if (text.trim().length === 0) throw new Error("本文が空です。");
  return await call<{ id: string; text: string }>("POST", "/2/tweets", creds, { text });
}
