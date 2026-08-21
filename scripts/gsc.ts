// Google Search Console からクエリ別・ページ別の順位/表示回数/クリックを取得して要約表示する。
// 「どの検索語で・何位に出て・何回表示/クリックされたか」= SEOの成績表。
//
// 認証はサービスアカウント（既存の mercari-automation の鍵を再利用）。
// 必要な環境変数（.env に記入。チャットに貼らないこと）:
//   GSC_KEY_FILE … サービスアカウント鍵JSONのパス
//                  例: C:\Users\user\Documents\kurodo\mercari_auto\google_credentials.json
//   GSC_SITE_URL … プロパティのURL。ハツコレは URLプレフィックス型なので末尾スラッシュ込みの
//                  "https://hatsukore.com/"（sc-domain: 形式ではない。2026-08-21 実測）
//
// 事前条件（一度だけ・本人操作）: Search Console の 設定 → ユーザーと権限 → ユーザーを追加 で
// サービスアカウントのメールアドレスを「制限付き」以上で追加しておく。
// 未追加だと 403 で落ちる（このスクリプトが案内を出す）。
//
// 実行: npm run gsc  （任意で日数: npm run gsc -- 28）
// 注意: GSCのデータは2〜3日遅れて確定する。「直近2日が0」は故障ではない。

import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { nowInstant } from "../src/lib/date";

const KEY_FILE = process.env.GSC_KEY_FILE;
const SITE_URL = process.env.GSC_SITE_URL;

type KeyJson = { client_email: string; private_key: string; token_uri: string };

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

async function getAccessToken(key: KeyJson): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: key.client_email,
      scope: "https://www.googleapis.com/auth/webmasters.readonly",
      aud: key.token_uri,
      iat,
      exp: iat + 3600,
    })
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(key.private_key, "base64url");
  const jwt = `${header}.${claims}.${signature}`;

  const res = await fetch(key.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`トークン取得失敗 (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

type GscRow = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number };

async function queryGsc(
  token: string,
  body: Record<string, unknown>
): Promise<GscRow[]> {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
    SITE_URL!
  )}/searchAnalytics/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 403) {
    console.error(
      "\n✗ 403: サービスアカウントにこのプロパティの権限がありません。\n" +
        "  Search Console (https://search.google.com/search-console/users?resource_id=" +
        encodeURIComponent(SITE_URL!) +
        ")\n  の「ユーザーと権限」→「ユーザーを追加」で、鍵JSONの client_email を「制限付き」以上で追加してください。"
    );
    process.exit(1);
  }
  if (!res.ok) {
    throw new Error(`searchAnalytics 取得失敗 (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const json = (await res.json()) as { rows?: GscRow[] };
  return json.rows ?? [];
}

// 日付境界はJSTで切る（analytics.ts と同じ規約）
function ymd(d: Date): string {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

function fmt(rows: GscRow[], label: (keys: string[]) => string): void {
  if (rows.length === 0) {
    console.log("  （データなし）");
    return;
  }
  for (const r of rows) {
    console.log(
      `  ${label(r.keys).padEnd(44)} 表示 ${String(r.impressions).padStart(5)}  クリック ${String(
        r.clicks
      ).padStart(3)}  順位 ${r.position.toFixed(1)}`
    );
  }
}

async function main() {
  if (!KEY_FILE || !SITE_URL) {
    console.error(".env に GSC_KEY_FILE と GSC_SITE_URL を設定してください。");
    process.exit(1);
  }
  const key = JSON.parse(readFileSync(KEY_FILE, "utf8")) as KeyJson;
  const token = await getAccessToken(key);

  const days = Number(process.argv[2]) || 28;
  const until = nowInstant();
  const range = {
    startDate: ymd(new Date(until.getTime() - days * 86_400_000)),
    endDate: ymd(until),
  };

  console.log(`=== ハツコレ Search Console（直近${days}日: ${range.startDate}〜${range.endDate}）===`);
  console.log(`プロパティ: ${SITE_URL} ／ SA: ${key.client_email}`);
  console.log("※ データは2〜3日遅れて確定する。直近2日が0でも故障ではない。");

  const daily = await queryGsc(token, { ...range, dimensions: ["date"], rowLimit: 100 });
  console.log("\n■ 日別（表示/クリック/平均順位）");
  fmt(daily, (k) => k[0]);

  const queries = await queryGsc(token, { ...range, dimensions: ["query"], rowLimit: 40 });
  console.log("\n■ クエリ別 TOP40（Googleが個別開示した分のみ＝表示回数の合計は総数より小さい）");
  fmt(queries, (k) => k[0]);

  const pages = await queryGsc(token, { ...range, dimensions: ["page"], rowLimit: 25 });
  console.log("\n■ ページ別 TOP25");
  fmt(pages, (k) => decodeURIComponent(k[0].replace(SITE_URL!.replace(/\/$/, ""), "")));

  const queryPage = await queryGsc(token, {
    ...range,
    dimensions: ["query", "page"],
    rowLimit: 25,
  });
  console.log("\n■ クエリ×ページ TOP25（どの語がどのページに効いているか）");
  fmt(queryPage, (k) => `${k[0]} → ${decodeURIComponent(k[1].replace(SITE_URL!.replace(/\/$/, ""), ""))}`);

  const countries = await queryGsc(token, { ...range, dimensions: ["country"], rowLimit: 10 });
  console.log("\n■ 国別（/en の立ち上がり観測用）");
  fmt(countries, (k) => k[0]);

  // 解釈の注意（analytics.ts の「自動解釈」と同じ趣旨）
  const totalImp = daily.reduce((s, r) => s + r.impressions, 0);
  const totalClicks = daily.reduce((s, r) => s + r.clicks, 0);
  console.log(
    `\n■ 合計  表示 ${totalImp} / クリック ${totalClicks}` +
      (totalImp > 0 ? ` / CTR ${((totalClicks / totalImp) * 100).toFixed(1)}%` : "")
  );
  console.log(
    "  読み方: 「順位」はその語で表示された時の平均位置。表示1回×1位のような少数データは順位が良く見えるので、\n" +
      "  表示回数とセットで読む。クエリ別の行はGoogleがプライバシーで間引くため、合計と一致しない。"
  );
}

main().then(() => process.exit(0));
