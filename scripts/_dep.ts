// 一時: 直近デプロイの状態確認。使い捨て。
const token = process.env.VERCEL_TOKEN;
const projectId = process.env.VERCEL_PROJECT_ID;
async function main() {
  const res = await fetch(`https://api.vercel.com/v6/deployments?projectId=${projectId}&limit=2`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = (await res.json()) as { deployments?: { readyState: string; url: string; meta?: Record<string, string> }[] };
  for (const d of json.deployments ?? []) console.log(d.readyState, d.url, (d.meta?.githubCommitSha ?? "").slice(0, 7));
}
main();
