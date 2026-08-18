/**
 * 「明日を先取りする」自己テスト（`npm run audit:tomorrow`）。
 *
 * **データを1バイトも変えず、暦だけを進めて監査を回し、鳴り始める検査を落とす。**
 *
 * なぜ要るか（実測2回、いずれも本番の更新を止めた/止めかけた）:
 *  ・2026-08-09 `/genre/スニーカー` 25→18件（-28%）で「2割減」が ERROR。中身は 8/7・8/8 発売の
 *    スニーカー10件が今日になって過去日になっただけ＝暦が進んだ結果で、何も壊れていない。
 *  ・2026-08-11 `/genre/ソフビ・アートトイ`（在籍1件・8/10開催）が過去日で抜け、ページごと消えて
 *    `page_vanished` が ERROR。**前日に足した検査が、翌朝いちばんに更新を止めた。**
 *
 * どちらも「翌朝データを取り直すまで分からない」型だった。日付だけ進めて回せば、**足したその日に**
 * 分かる。検査を足す側の思い込み（今日のデータで鳴らないから正しい）を、機械で潰すための道具。
 *
 * 仕組み: `HATSUKORE_SIMULATE_TODAY` を渡して `audit --dry --machine` を子プロセスで回す。
 * `todayJst()` はサイトの掲載基準・ページ・監査が共通で使う唯一の「今日」なので、ここを差し替える
 * だけで「その日のサイト」が再現できる。`--dry` で何も書かない＝**検証の実行が次回の比較基準を
 * 汚さない**（2026-08-09 に踏んだ型）。
 *
 * 判定: 今日 ERROR でない検査が、未来日で ERROR になったら落とす。
 * ただし**暦で鳴るのが仕事の検査**（鮮度・放置された予定）は除く＝下の CALENDAR_EXPECTED。
 * このリストは「鳴ってよい理由」を1件ずつ書いてから足すこと。安易に足すと、この道具自体が
 * 「誤報を黙らせる場所」に変わる。
 *
 * 使い方: `npm run audit:tomorrow`（既定 +1日 と +7日）／`npm run audit:tomorrow -- --days 1,3,30`
 */
import { spawnSync } from "node:child_process";
import { todayJst } from "../src/lib/date";

/** 暦が進めば鳴るのが**正しい**検査（＝データが古くなったことを見張る検査）。 */
const CALENDAR_EXPECTED = new Set([
  // 収集元が更新されない＝日が経てば必ず鮮度が落ちる。それを見つけるのがこの検査の仕事。
  "source_stale",
  "source_stale_by_design",
  "site_update_stalled",
  // 「予約受付中」等が期限を過ぎたまま残っている＝時間が経つほど増えるのが正しい。
  "stale_promise",
  "date_text_past",
  // 「0件が正常」と理由を書いたソース（audit.ts の MAY_BE_EMPTY）が0件になる検査。
  // この道具は**データを凍結したまま暦だけ**進めるので、窓の短いカレンダー（billys＝
  // 収集元が約1週間先まで／mita_draw＝受付が数日で閉じる）は日が進めば必ず0件になる。
  // 実運用では毎日巡回して入れ替わるので、本物の「ソースが死んだ」は通常の
  // `npm run audit` のラチェットが捕まえる。ここで拾うと**翌朝の更新を誤報で止める**
  // （2026-08-18 に実際に +1日で ERROR になると予告された。ソース6本追加の翌日）。
  "source_empty_by_design",
  // 「載っていて当然の層」が0件になる検査（watchlist）。この道具はデータを凍結したまま暦だけ
  // 進めるので、日が経つほど掲載が縮み、ゼロの層は必ず増える。実運用では毎日新しい商品が
  // 入るので、本物の「その層が取れなくなった」は通常の `npm run audit` のラチェットが捕まえる。
  "watchlist_zero",
  // 母数（＝各検査が見た件数）は表示件数に比例する。この道具は**データを凍結したまま暦だけ**
  // 進めるので、掲載が縮めば母数も必ず縮む＝この道具では真偽を判定できない。
  // 実測（+30日）: Xミラー由来の title_noise 4種が母数24→1件。実運用では毎日新しい記事が入る
  // ので、本物の「検査が空振りし始めた」は通常の `npm run audit` が捕まえる。
  "check_coverage_shrunk",
  "check_idle",
]);

const args = process.argv.slice(2);
const daysArg = args[args.indexOf("--days") + 1];
const OFFSETS =
  args.includes("--days") && daysArg
    ? daysArg.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0)
    : [1, 7];

type Result = { date: string; errors: Set<string>; all: Map<string, number> };

function runAudit(simulate: string | null): Result {
  const res = spawnSync(
    process.execPath,
    ["--env-file-if-exists=.env", "--import", "tsx", "scripts/audit.ts", "--dry", "--machine"],
    {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: simulate ? { ...process.env, HATSUKORE_SIMULATE_TODAY: simulate } : process.env,
    }
  );
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  const errors = new Set<string>();
  const all = new Map<string, number>();
  for (const line of out.split(/\r?\n/)) {
    const m = /^##CHECK\t([a-z0-9_]+)\t(error|warn)\t(\d+)$/.exec(line);
    if (!m) continue;
    all.set(m[1], Number(m[3]));
    if (m[2] === "error") errors.add(m[1]);
  }
  if (!all.size) {
    console.error(out.split(/\r?\n/).slice(-25).join("\n"));
    throw new Error(`監査が結果を返しませんでした（simulate=${simulate ?? "今日"}）`);
  }
  return { date: simulate ?? "今日", errors, all };
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function main() {
  const today = todayJst();
  console.log(`== 明日を先取りする自己テスト（基準日 ${ymd(today)} / +${OFFSETS.join("日, +")}日） ==`);
  console.log("   データは変えず、暦だけを進めて監査を回します。");

  const base = runAudit(null);
  console.log(`\n今日（${ymd(today)}）: ERROR ${base.errors.size}種${base.errors.size ? ` [${[...base.errors].join(" ")}]` : ""}`);

  const bad: string[] = [];
  for (const off of OFFSETS) {
    const d = ymd(new Date(today.getTime() + off * 86_400_000));
    const r = runAudit(d);
    const fresh = [...r.errors].filter((k) => !base.errors.has(k));
    const unexpected = fresh.filter((k) => !CALENDAR_EXPECTED.has(k));
    const expected = fresh.filter((k) => CALENDAR_EXPECTED.has(k));
    console.log(
      `+${off}日（${d}）: ERROR ${r.errors.size}種` +
        (expected.length ? ` ／ 暦で鳴るのが正しい検査: ${expected.join(" ")}` : "")
    );
    for (const k of unexpected)
      bad.push(`+${off}日（${d}）で ${k} が ERROR になる（今日は鳴っていない・件数 ${r.all.get(k)}）`);
  }

  if (bad.length) {
    console.log(`\n【❌】暦が進むだけで鳴り始める検査があります（翌朝の更新を誤報で止めます）:`);
    for (const s of bad) console.log(`   - ${s}`);
    console.log(
      `\n   直し方: 閾値を緩めるのではなく、**理由で分ける**（src/lib/pageLoss.ts と同じ）。\n` +
        `   暦で鳴るのが仕事の検査なら CALENDAR_EXPECTED に理由を書いて足す。`
    );
    process.exitCode = 1;
  } else {
    console.log(`\n==== 明日を先取り: 暦だけで鳴り始める検査は 0種 ====`);
  }
}

main();
