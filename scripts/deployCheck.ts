/**
 * 直近のVercelデプロイが本当に READY になったかを確かめる（`npm run deploy:check`）。
 *
 * 由来 = ミス8（2026-08-03）: build 後にファイルを1つ足して push したら、そのファイルの
 * 型エラーで Vercel の build が失敗（state=ERROR）。本番は1つ前の READY を配信し続けたので、
 * **push したのに新機能が出ない**状態になった。そこを「キャッシュ/遅延だろう」と10分以上
 * 誤認した。push＝デプロイ成功、と暗黙に仮定していたのが原因。
 *
 * push のあとはこれを回す。ERROR ならビルドログの先頭を出すので、原因の推測をしなくて済む。
 */
const TOKEN = process.env.VERCEL_TOKEN;
const PROJECT = process.env.VERCEL_PROJECT_ID;

type Deployment = {
  uid: string;
  name: string;
  state: string;
  readyState?: string;
  created: number;
  meta?: { githubCommitSha?: string; githubCommitMessage?: string };
};

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.vercel.com${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`vercel ${res.status} ${path}`);
  return (await res.json()) as T;
}

async function main() {
  if (!TOKEN || !PROJECT) {
    console.error("VERCEL_TOKEN / VERCEL_PROJECT_ID が .env にありません。");
    process.exit(1);
  }
  const { deployments } = await api<{ deployments: Deployment[] }>(
    `/v6/deployments?projectId=${PROJECT}&limit=3`
  );
  if (!deployments?.length) {
    console.error("デプロイが1件も取得できませんでした（projectId を確認）。");
    process.exit(1);
  }

  const latest = deployments[0];
  const state = latest.readyState ?? latest.state;
  const when = new Date(latest.created).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  const sha = latest.meta?.githubCommitSha?.slice(0, 7) ?? "?";
  const msg = (latest.meta?.githubCommitMessage ?? "").split("\n")[0];
  console.log(`最新デプロイ: ${state}  ${when}  ${sha}  ${msg}`);

  if (state === "READY") {
    console.log("✅ 本番に反映済みです。");
    return;
  }
  if (state === "BUILDING" || state === "QUEUED" || state === "INITIALIZING") {
    console.log("⏳ まだビルド中です。少し待ってもう一度実行してください。");
    process.exitCode = 2;
    return;
  }

  console.error(`❌ デプロイが ${state} です。**本番は1つ前のバージョンを配信し続けています。**`);
  try {
    const events = await api<{ text?: string; payload?: { text?: string } }[]>(
      `/v3/deployments/${latest.uid}/events?builds=1&limit=200`
    );
    const lines = events
      .map((e) => e.text ?? e.payload?.text ?? "")
      .filter((t) => /error|Error|failed|Failed|Type error/.test(t))
      .slice(0, 20);
    if (lines.length) {
      console.error("--- ビルドログ（エラー行） ---");
      for (const l of lines) console.error("  " + l.trim().slice(0, 200));
    }
  } catch (e) {
    console.error(`（ビルドログの取得に失敗: ${(e as Error).message}）`);
  }
  process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
