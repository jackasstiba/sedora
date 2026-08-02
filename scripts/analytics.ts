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

// 日付境界は日本時間(JST=UTC+9)で切る。素の toISOString() は UTC のため、
// 深夜〜朝に実行すると「今日」が1日ずれて当日分を取りこぼす/はみ出すバグになる。
function ymd(d: Date): string {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
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

  // ── 解釈（実来訪か開発検証/クローラのノイズかを見分ける補助）─────────────
  // レアレーダーは新規ドメインでSEO育成中。数字が小さいうちは「自分の検証アクセス」と
  // 「実際の外部ユーザー」が混ざり、素の数字だけ見ると誤読しやすいので指標を出す。
  const refRows = referrers?.data ?? [];
  const totalRefPv = refRows.reduce((s, r) => s + Number(r.pageviews || 0), 0);
  const directPv = refRows
    .filter((r) => !String(r.referrerHostname ?? "").trim())
    .reduce((s, r) => s + Number(r.pageviews || 0), 0);
  const organicPv = totalRefPv - directPv;
  const deskRows = devices?.data ?? [];
  const deskPv = deskRows
    .filter((r) => String(r.deviceType ?? "") === "desktop")
    .reduce((s, r) => s + Number(r.pageviews || 0), 0);
  const deskTotal = deskRows.reduce((s, r) => s + Number(r.pageviews || 0), 0);
  console.log("\n■ 解釈（自動）");
  if (totalRefPv > 0) {
    const directPct = Math.round((directPv / totalRefPv) * 100);
    console.log(
      `  流入内訳: 直接/不明 ${directPv}PV (${directPct}%) / 外部サイト経由 ${organicPv}PV`
    );
    if (organicPv === 0) {
      console.log(
        "  ⚠ 検索・SNS・被リンクからの流入がゼロ。= 発見経路が機能していない（SEO未インデックス）。"
      );
    }
  }
  if (deskTotal > 0) {
    const deskPct = Math.round((deskPv / deskTotal) * 100);
    if (deskPct >= 60) {
      console.log(
        `  デバイス: デスクトップ ${deskPct}%。コレクター向け消費サイトとしては不自然に高く、` +
          "自分の検証アクセス/クローラの割合が大きい可能性。"
      );
    }
  }

  // ── カスタムイベント ──────────────────────────────────────────
  //   genre_select  … どのジャンルが見られているか（FilterBar）
  //   search        … 何が検索されたか＝需要シグナル（FilterBar）
  //   outbound_click… 外部の購入/公式ページへ送客できたか＝アフィリ収益の唯一の成果指標
  //                   （OutboundLink。自サイト内リンクと違いPVには出ないためイベントで拾う）
  // ⚠ Hobbyプランではカスタムイベントの「API取得」がPro以上限定(HTTP402)。
  //   取れない場合でも Vercelダッシュボード → Analytics → Events では閲覧可能。
  const eventSpecs: { name: string; by: string; title: string; unit: string }[] = [
    { name: "genre_select", by: "eventData/genre", title: "人気ジャンル（クリック数） TOP20", unit: "クリック" },
    { name: "search", by: "eventData/query", title: "検索キーワード（需要シグナル） TOP20", unit: "検索" },
    { name: "outbound_click", by: "eventData/kind", title: "外部送客（購入導線クリック＝収益成果）", unit: "クリック" },
  ];
  let planBlocked = false;
  for (const spec of eventSpecs) {
    const ev = (await query("events/aggregate", {
      ...range,
      by: spec.by,
      limit: "20",
      filter: `eventName eq '${spec.name}'`,
    })) as { data?: Row[]; planLimited?: boolean } | null;
    console.log(`\n■ ${spec.title}`);
    if (ev?.planLimited) {
      planBlocked = true;
      console.log("  （Hobbyプランでは取得不可。ダッシュボードのEventsタブで確認）");
    } else if (!ev?.data?.length) {
      console.log("  （まだデータなし。イベント計測は反映に時間がかかる）");
    } else {
      for (const r of ev.data) {
        const label = String(r.eventData ?? "").trim() || "(不明)";
        console.log(`  ${label.padEnd(24)} ${spec.unit} ${r.count}\t訪問者 ${r.visitors}`);
      }
    }
  }
  if (planBlocked) {
    console.log(
      "\n  ※ カスタムイベントをClaudeが直接分析するには Pro へのアップグレード、" +
        "\n    または Turso への自前イベント記録（無料枠可・Claudeが直接クエリ可）が必要。"
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
