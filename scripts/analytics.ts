// Vercel Web Analytics API からアクセス状況を取得して要約表示する。
// Claude が直接データを読んで分析できるようにするためのスクリプト。
//
// 必要な環境変数（.env に本人が記入。チャットに貼らないこと）:
//   VERCEL_TOKEN      … Vercelアクセストークン（ダッシュボード→Settings→Tokens）
//   VERCEL_PROJECT_ID … 対象プロジェクトのID（プロジェクト→Settings→General）
//   VERCEL_TEAM_ID    … チーム所有の場合のみ（個人アカウントなら不要）
//
// 実行: npm run analytics  （任意で日数: npm run analytics -- 7）

const BASE = "https://api.vercel.com/v1/query/web-analytics";

const TOKEN = process.env.VERCEL_TOKEN;
const PROJECT_ID = process.env.VERCEL_PROJECT_ID;
const TEAM_ID = process.env.VERCEL_TEAM_ID;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function query(
  path: string,
  params: Record<string, string>
): Promise<{ data?: unknown; planLimited?: boolean } | null> {
  const qs = new URLSearchParams({ projectId: PROJECT_ID!, ...params });
  if (TEAM_ID) qs.set("teamId", TEAM_ID);
  const res = await fetch(`${BASE}/${path}?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) {
    // 402 = プラン制限（Hobbyではカスタムイベント取得にPro以上が必要）。エラー扱いしない。
    if (res.status === 402) return { planLimited: true };
    const body = await res.text();
    console.error(`  ✗ ${path} 取得失敗 (HTTP ${res.status}): ${body.slice(0, 200)}`);
    return null;
  }
  return res.json();
}

type Row = Record<string, string | number>;

function printRows(title: string, rows: Row[] | undefined, key: string, blankLabel = "(不明)") {
  console.log(`\n■ ${title}`);
  if (!rows || rows.length === 0) {
    console.log("  （データなし）");
    return;
  }
  for (const r of rows) {
    const label = String(r[key] ?? "").trim() || blankLabel;
    console.log(`  ${label.padEnd(28)} PV ${r.pageviews}\t訪問者 ${r.visitors}`);
  }
}

async function main() {
  if (!TOKEN || !PROJECT_ID) {
    console.error(
      "環境変数が未設定です。.env に VERCEL_TOKEN と VERCEL_PROJECT_ID を設定してください" +
        "（チーム所有なら VERCEL_TEAM_ID も）。"
    );
    process.exit(1);
  }

  const days = Number(process.argv[2]) || 30;
  const until = new Date();
  const since = new Date();
  since.setDate(since.getDate() - days);
  const range = { since: ymd(since), until: ymd(until) };

  console.log(`=== レアレーダー アクセス解析（直近${days}日: ${range.since}〜${range.until}）===`);

  const total = (await query("visits/count", {})) as { data?: Row } | null;
  if (total?.data) {
    console.log(`\n■ 累計（本番・全期間）  PV ${total.data.pageviews}\t訪問者 ${total.data.visitors}`);
  }

  const daily = (await query("visits/aggregate", { ...range, by: "day" })) as {
    data?: Row[];
  } | null;
  if (daily?.data?.length) {
    const pv = daily.data.reduce((s, r) => s + Number(r.pageviews), 0);
    const vi = daily.data.reduce((s, r) => s + Number(r.visitors), 0);
    console.log(`\n■ 直近${days}日の合計  PV ${pv}\t訪問者 ${vi}`);
    console.log("  日別:");
    for (const r of daily.data) {
      console.log(`    ${String(r.timestamp).slice(0, 10)}  PV ${r.pageviews}\t訪問者 ${r.visitors}`);
    }
  } else {
    console.log(`\n■ 直近${days}日  （データなし）`);
  }

  const referrers = (await query("visits/aggregate", {
    ...range,
    by: "referrerHostname",
    limit: "10",
  })) as { data?: Row[] } | null;
  printRows("流入元（リファラー） TOP10", referrers?.data, "referrerHostname", "直接/不明");

  const countries = (await query("visits/aggregate", {
    ...range,
    by: "country",
    limit: "10",
  })) as { data?: Row[] } | null;
  printRows("国 TOP10", countries?.data, "country");

  const devices = (await query("visits/aggregate", {
    ...range,
    by: "deviceType",
    limit: "10",
  })) as { data?: Row[] } | null;
  printRows("デバイス", devices?.data, "deviceType");

  // ジャンル選択のカスタムイベント（FilterBar の track("genre_select", {genre})）
  const genres = (await query("events/aggregate", {
    ...range,
    by: "eventData/genre",
    limit: "20",
    filter: "eventName eq 'genre_select'",
  })) as { data?: Row[]; planLimited?: boolean } | null;
  console.log("\n■ 人気ジャンル（クリック数） TOP20");
  if (genres?.planLimited) {
    console.log("  （HobbyプランではカスタムイベントのAPI取得にPro以上が必要。ジャンル別集計は現状不可）");
  } else if (!genres?.data?.length) {
    console.log("  （まだデータなし。イベント計測は反映に時間がかかる）");
  } else {
    for (const r of genres.data) {
      const label = String(r.eventData ?? "").trim() || "(不明)";
      console.log(`  ${label.padEnd(20)} クリック ${r.count}\t訪問者 ${r.visitors}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
