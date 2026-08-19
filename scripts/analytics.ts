// Vercel Web Analytics API からアクセス状況を取得して要約表示する。
// Claude が直接データを読んで分析できるようにするためのスクリプト。
//
// 必要な環境変数（.env に本人が記入。チャットに貼らないこと）:
//   VERCEL_TOKEN      … Vercelアクセストークン（ダッシュボード→Settings→Tokens）
//   VERCEL_PROJECT_ID … 対象プロジェクトのID（プロジェクト→Settings→General）
//   VERCEL_TEAM_ID    … チーム所有の場合のみ（個人アカウントなら不要）
//
// 実行: npm run analytics  （任意で日数: npm run analytics -- 7）

import { prisma } from "@/lib/prisma";
import { nowInstant } from "../src/lib/date";
import { NOLOG_OPTOUT_EVENT } from "../src/lib/nolog";

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

// URLエンコードされた日本語パス（/genre/%E3%83%88...）はそのままでは読めないので戻す。
function decodePaths(rows: Row[] | undefined, key: string): Row[] | undefined {
  if (!rows) return rows;
  return rows.map((r) => {
    try {
      return { ...r, [key]: decodeURIComponent(String(r[key] ?? "")) };
    } catch {
      return r;
    }
  });
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
  const until = nowInstant();
  const since = new Date(until.getTime() - days * 86_400_000);
  const range = { since: ymd(since), until: ymd(until) };

  console.log(`=== ハツコレ アクセス解析（直近${days}日: ${range.since}〜${range.until}）===`);

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

  // ── ページ別（どこが見られているか）──────────────────────────
  // requestPath は実URL（/items/516）、route は雛形（/items/[id]）。
  // 「どの記事が読まれたか」は requestPath、「どの画面が機能しているか」は route で見る。
  // ※ ここは以前この解析から丸ごと抜けていて、PVの総数しか見えていなかった。
  const routes = (await query("visits/aggregate", {
    ...range,
    by: "route",
    limit: "20",
  })) as { data?: Row[] } | null;
  printRows("画面の種類（route）", routes?.data, "route");

  const paths = (await query("visits/aggregate", {
    ...range,
    by: "requestPath",
    limit: "25",
  })) as { data?: Row[] } | null;
  printRows("よく見られたページ TOP25", decodePaths(paths?.data, "requestPath"), "requestPath");

  const browsers = (await query("visits/aggregate", {
    ...range,
    by: "browserName",
    limit: "10",
  })) as { data?: Row[] } | null;
  printRows("ブラウザ", browsers?.data, "browserName");

  const os = (await query("visits/aggregate", {
    ...range,
    by: "osName",
    limit: "10",
  })) as { data?: Row[] } | null;
  printRows("OS", os?.data, "osName");

  // ── 日本の訪問者だけを切り出す ────────────────────────────────
  // ハツコレは日本語・日本の発売情報しか扱わないので、海外からの訪問は
  // 実需ではなくクローラ/スクレイパである可能性が高い。混ぜたまま眺めると
  // 「伸びている」と誤読するため、JPだけの数字を別に出す。
  const jpRoutes = (await query("visits/aggregate", {
    ...range,
    by: "route",
    limit: "20",
    filter: "country eq 'JP'",
  })) as { data?: Row[] } | null;
  printRows("【日本のみ】画面の種類", jpRoutes?.data, "route");

  const jpPaths = (await query("visits/aggregate", {
    ...range,
    by: "requestPath",
    limit: "20",
    filter: "country eq 'JP'",
  })) as { data?: Row[] } | null;
  printRows("【日本のみ】よく見られたページ", decodePaths(jpPaths?.data, "requestPath"), "requestPath");

  // ── 検索・SNSからの着地ページ ────────────────────────────────
  // リファラが付いた訪問がどのページに落ちたか＝SEOで実際に効いている面。
  // 総数が小さいうちはここが唯一の「外の世界に見つかった証拠」になる。
  const refHosts = (referrers?.data ?? [])
    .map((r) => String(r.referrerHostname ?? "").trim())
    .filter((h) => h.length > 0);
  if (refHosts.length > 0) {
    console.log("\n■ 外部からの着地ページ（リファラ別）");
    for (const host of refHosts) {
      const landed = (await query("visits/aggregate", {
        ...range,
        by: "requestPath",
        limit: "10",
        filter: `referrerHostname eq '${host}'`,
      })) as { data?: Row[] } | null;
      console.log(`  ${host}`);
      for (const r of decodePaths(landed?.data, "requestPath") ?? []) {
        console.log(`    ${String(r.requestPath).padEnd(40)} PV ${r.pageviews}\t訪問者 ${r.visitors}`);
      }
    }
  }

  // ── 解釈（実来訪か開発検証/クローラのノイズかを見分ける補助）─────────────
  // ハツコレは新規ドメインでSEO育成中。数字が小さいうちは「自分の検証アクセス」と
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
  // 海外比率。日本語の発売情報しか扱わないサイトで海外PVが多いのは、
  // 実需ではなくクローラ/スクレイパが大量にページを舐めている型。
  // 「1訪問者あたりPV」が異常に大きい国は人間の読み方ではない。
  const cRows = countries?.data ?? [];
  const cTotal = cRows.reduce((s, r) => s + Number(r.pageviews || 0), 0);
  const jpPv = cRows
    .filter((r) => String(r.country ?? "") === "JP")
    .reduce((s, r) => s + Number(r.pageviews || 0), 0);
  if (cTotal > 0 && cTotal - jpPv > 0) {
    const foreignPct = Math.round(((cTotal - jpPv) / cTotal) * 100);
    console.log(`  国: 日本 ${jpPv}PV / 海外 ${cTotal - jpPv}PV (${foreignPct}%)`);
    // 期間平均で割ると、1日だけの大量巡回が30日で薄まって見えなくなる
    // （実測: US 116PV/31人＝平均3.7でも、8/18の1日だけで196PV/13人だった）。
    // なので日単位まで降りて、その日だけ跳ねている国を名指しする。
    for (const r of cRows) {
      const country = String(r.country ?? "");
      if (country === "JP" || !country) continue;
      const byDay = (await query("visits/aggregate", {
        ...range,
        by: "day",
        filter: `country eq '${country}'`,
      })) as { data?: Row[] } | null;
      for (const d of byDay?.data ?? []) {
        const pv = Number(d.pageviews || 0);
        const vi = Number(d.visitors || 0);
        if (vi === 0 || pv < 30) continue;
        const perVisitor = pv / vi;
        if (perVisitor >= 8) {
          console.log(
            `  ⚠ ${String(d.timestamp).slice(0, 10)} の ${country}: ${pv}PV / ${vi}人` +
              `（1人あたり ${perVisitor.toFixed(1)}ページ）。人間の閲覧ではなく` +
              "クローラ/スクレイパの可能性が高い＝伸びた実績として数えない。"
          );
        }
      }
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
      "\n  ↑ Vercel側はHobbyで取得不可。以下の自前記録(Turso)が同じイベントを読める本命ソース。"
    );
  }

  // ── 自前記録（Turso Event）＝Hobbyでも読めるカスタムイベント ──────────
  // ユーザー操作イベントを /api/track 経由で Turso に直接記録している。
  // Vercel の 402 制約を受けず Claude が直接集計できる。PV/流入元は上の Vercel 側が担当。
  await readSelfHosted(since);
}

async function readSelfHosted(since: Date) {
  console.log("\n=== 自前記録イベント（Turso・直近同期間） ===");
  let events: { name: string; value: string | null }[];
  try {
    events = await prisma.event.findMany({
      where: { createdAt: { gte: since } },
      select: { name: true, value: true },
    });
  } catch (err) {
    console.log(
      "  （Event テーブル未作成の可能性。本番は `npm run migrate:events` で作成）"
    );
    console.error("  ", (err as Error).message);
    return;
  }
  const specs: { name: string; title: string; unit: string }[] = [
    { name: "genre_select", title: "人気ジャンル（クリック数）", unit: "クリック" },
    { name: "search", title: "検索キーワード（需要シグナル）", unit: "検索" },
    { name: "outbound_click", title: "外部送客（購入導線クリック＝収益成果）", unit: "クリック" },
  ];
  // 除外を始めたブラウザの数。**?nolog=1 の付いたURLが外に漏れると本物の読者が黙って消える**ので、
  // ここが不自然に増えていないかを毎回見る（自分の端末ぶんだけのはず）。
  const optOuts = events.filter((e) => e.name === NOLOG_OPTOUT_EVENT).length;
  console.log(`
■ 自分のアクセス除外  この期間に除外を始めたブラウザ ${optOuts} 台`);
  if (optOuts > 5) {
    console.log(
      "  ⚠ 台数が多い。?nolog=1 の付いたURLが外部に共有されていないか確認する（本物の読者が数から消える）。"
    );
  }
  for (const spec of specs) {
    const counts = new Map<string, number>();
    for (const e of events) {
      if (e.name !== spec.name) continue;
      const label = (e.value ?? "").trim() || "(不明)";
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    console.log(`\n■ ${spec.title}`);
    if (counts.size === 0) {
      console.log("  （まだデータなし）");
      continue;
    }
    const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
    for (const [label, n] of rows) {
      console.log(`  ${label.padEnd(24)} ${spec.unit} ${n}`);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
