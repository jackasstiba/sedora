/**
 * 一次情報との突合（`npm run audit:facts`）。
 *
 * ここまでの監査は「自分の中で辻褄が合っているか」しか見ていない。データが最初から
 * 間違っていれば、どれだけ不変条件を足しても素通りする。そこで **リンク先の本文** を取り、
 * 手元の値と突き合わせる。
 *
 * ただし突合は誤報しやすい（SPA・画像内テキスト・表記ゆれ）。実測した信号の強さは:
 *   ・識別語がリンク先に出るか … 強い（商品の同一性。0/2以上で外れは実際に陳腐化・誤リンク）
 *   ・価格が本文にあるか       … 中（数字は載っていることが多いが、税抜/税込で揺れる）
 *   ・日付が本文にあるか       … 弱い（書式が多様・画像化されている）→ **判定しない。参考値だけ出す**
 * よって指摘するのは「識別語が1つも出ない」「価格が本文に無い」の2つに絞り、
 * どちらも WARN（要確認）に留める。誤報する検査は本物を埋もれさせるため。
 *
 * 使い方: npm run audit:facts [-- --per-source 3] [-- --source figisland]
 */
import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import { prisma } from "../src/lib/prisma";
import { loadDisplayedItems } from "../src/lib/pages";
import { cleanListTitle } from "../src/lib/title";
import { normalizeForSearch } from "../src/lib/itemFilter";
import { franchiseAliases } from "../src/lib/franchise";
import { parseYen } from "../src/lib/margin";

// 本文の代わりにログイン壁・同意画面を返すホスト。文字数は十分あるので「本文が取れた」と
// 誤認し、識別語が1つも出ない＝要確認、という**中身を見ていない誤報**になる（実測: x_watch の
// item.url は投稿ではなくアカウントページで、そもそも画面にも出していないリンクだった）。
// 判定材料にならないものは「判定不能」に数える。0件と誤報は違う。
const WALLED_HOSTS = /(^|\.)(x\.com|twitter\.com)$/i;

const args = process.argv.slice(2);
const perIdx = args.indexOf("--per-source");
const PER_SOURCE = perIdx >= 0 ? Number(args[perIdx + 1]) || 3 : 3;
const srcIdx = args.indexOf("--source");
const ONLY_SOURCE = srcIdx >= 0 ? args[srcIdx + 1] : null;
const UPDATE_BASELINE = args.includes("--update-baseline");

// ── この検査自身が空振り・後退していないか ─────────────────────────────────
// 2026-08-09 実測: このスクリプトは **1件も突合できなくても「要確認 0件」と出して exit 0**
// だった（`--source zzz` で再現）。run_scrape.bat はこれを関門として呼んでいるので、
// 構造上ぜったいに失敗しない関門＝無いのと同じだった。昨日 audit.ts で潰した
// 「見た上での0か、何も見ていない0か」がここだけ手つかずで残っていた（[[System/rules]]）。
// さらに指摘件数のラチェットも無く、要確認が 0→15 に増えても誰も止めない（WARN放置の再来）。
// ラチェットの保管先は audit-baseline.json に揃える（監査の基準はこのファイル、という約束）。
const BASELINE_PATH = path.join(process.cwd(), "audit-baseline.json");
type FactsBaseline = { checked: number; findings: number };
function loadFactsBaseline(): FactsBaseline | null {
  try {
    return (JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")).facts as FactsBaseline) ?? null;
  } catch {
    return null;
  }
}
function saveFactsBaseline(next: FactsBaseline) {
  const cur = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
  cur.facts = next;
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(cur, null, 2) + "\n");
  console.log(`\nbaseline(facts) を更新: ${BASELINE_PATH}`);
}

// 商品名に頻出する一般語。識別語から外さないと「フィギュア」だけで一致してしまう。
const GENERIC =
  /^(フィギュア|ぬいぐるみ|プラモデル|カードゲーム|ブースターパック|拡張パック|完成品|限定|特典|予約|発売|再販|セット|ver|box|新作|グッズ|コラボ|オンライン|一番くじ|抽選|販売|アクリルスタンド|キーホルダー|ポップアップストア)$/i;

function identityTokens(title: string): string[] {
  return title
    .split(/[\s　【】『』「」（）()[\]・/／\-–—~〜,、。!！?？:：＆&×✕]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !GENERIC.test(t))
    .map(normalizeForSearch)
    .filter((t, i, a) => a.indexOf(t) === i)
    .slice(0, 6);
}

async function pageText(url: string): Promise<string | null> {
  try {
    if (WALLED_HOSTS.test(new URL(url).hostname)) return null;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SedoriRadar-audit/1.0)" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const $ = cheerio.load(await res.text());
    $("script, style, noscript").remove();
    const t = $("body").text().replace(/\s+/g, " ");
    // 本文が極端に短いページ（SPAの殻など）は判定材料にならないので除外する。
    return t.length < 500 ? null : normalizeForSearch(t);
  } catch {
    return null;
  }
}

type Finding = { kind: string; detail: string };

/** 画像URLが表示できない理由（表示できるなら null）。取得できない＝判定不能は null に倒す。 */
async function deadImageReason(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SedoriRadar-audit/1.0)" },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status >= 400) return `HTTP ${res.status}`;
    const ct = res.headers.get("content-type") ?? "";
    if (ct && !ct.startsWith("image/")) return `画像ではない（${ct.slice(0, 30)}）`;
    return null;
  } catch {
    return null; // ネットワーク側の一時失敗を「画像が死んだ」と言わない
  }
}

async function main() {
  const rows = (await loadDisplayedItems()).filter((r) => !ONLY_SOURCE || r.source === ONLY_SOURCE);
  const bySource = new Map<string, typeof rows>();
  for (const r of rows) (bySource.get(r.source) ?? bySource.set(r.source, []).get(r.source)!).push(r);

  const findings: Finding[] = [];
  let checked = 0;
  let unusable = 0;
  let dateHit = 0;
  let dateTotal = 0;
  let imageChecked = 0;

  console.log(`== ハツコレ 一次情報の突合 == (ソースごと ${PER_SOURCE}件)`);

  for (const [source, arr] of bySource) {
    // 決定的に散らす（毎回同じ先頭だけを見ると、同じページしか検査しない）。
    const step = Math.max(1, Math.floor(arr.length / PER_SOURCE));
    const sample = arr.filter((_, i) => i % step === 0).slice(0, PER_SOURCE);
    for (const r of sample) {
      // (0) 画像が今も表示できるか。**画像は静かに腐る**（収集元がURLを変える・消す）。
      //     表示側では「画像なし」と見分けがつかないので、抜き取りで外から確かめる。
      //     判定は GET の結果だけで行う（HEAD を拒むCDNがあり、過去に HEAD/GET の違いで誤報した）。
      if (r.imageUrl) {
        imageChecked++;
        const bad = await deadImageReason(r.imageUrl);
        if (bad)
          findings.push({
            kind: "画像が表示できない",
            detail: `[${source} #${r.id}] ${bad} ${r.imageUrl.slice(0, 80)}`,
          });
      }

      const text = await pageText(r.url);
      if (!text) {
        unusable++;
        continue;
      }
      checked++;
      const title = cleanListTitle(r.source, r.title);
      const toks = identityTokens(title);

      // (1) 同一性: 識別語が2つ以上あるのに1つも本文に出てこない＝別物か陳腐化。
      //     ただし作品名は日英・カナで表記が割れる（こちらが「ONE PIECE カードゲーム」、
      //     一次情報は「ワンピースカードゲーム」＝正しいリンクなのに要確認になっていた）。
      //     既にある作品エイリアス表を同一性の判定にも通す。
      const aliases = franchiseAliases(title).map(normalizeForSearch);
      const matched = toks.some((k) => text.includes(k)) || aliases.some((a) => text.includes(a));
      if (toks.length >= 2 && !matched) {
        findings.push({
          kind: "リンク先に商品が見当たらない",
          detail: `[${source} #${r.id}] 識別語 ${toks.join(" / ")} がどれも本文に無い → ${r.url}`,
        });
      }

      // (2) 価格: 手元の定価が本文のどこにも出てこない。
      //     ただし**リンク先が検索結果ページのソース**（gunpla_resale等＝収集元非公開で
      //     楽天検索を導線にしている）は対象外。検索結果に並ぶのは出品者の実売価格で、
      //     カタログ定価が載っている保証がそもそも無い＝この検査の前提（リンク先＝価格の
      //     一次情報）が成り立たない。実測: HGUC ボール 定価1,760円が検索結果に無く誤報。
      const urlIsSearchPage = /search\.rakuten\.co\.jp|shopping\.yahoo\.co\.jp\/search|amazon\.co\.jp\/s\b/.test(r.url);
      const yen = !urlIsSearchPage && r.price ? parseYen(r.price.split(" / ")[0]) : null;
      if (yen != null && yen > 0) {
        const forms = [String(yen), yen.toLocaleString("en-US")];
        if (!forms.some((f) => text.includes(normalizeForSearch(f)))) {
          findings.push({
            kind: "価格が一次情報に見当たらない",
            detail: `[${source} #${r.id}] 掲載価格 ${r.price} が本文に無い ${title.slice(0, 40)}`,
          });
        }
      }

      // (3) 日付は参考値のみ（書式が多様で判定に耐えない）。
      if (r.eventDate) {
        const d = new Date(r.eventDate);
        dateTotal++;
        if (
          text.includes(`${d.getUTCMonth() + 1}月${d.getUTCDate()}日`) ||
          text.includes(`${d.getUTCMonth() + 1}/${d.getUTCDate()}`)
        )
          dateHit++;
      }
      await new Promise((s) => setTimeout(s, 300));
    }
  }

  console.log(
    `突合できたページ ${checked}件 / 本文を取れず判定不能 ${unusable}件 / 画像を確かめた ${imageChecked}件 / ` +
      `日付が本文に見つかった割合 ${dateTotal ? Math.round((dateHit / dateTotal) * 100) : 0}%（参考・判定には使わない）`
  );

  const byKind = new Map<string, Finding[]>();
  for (const f of findings) (byKind.get(f.kind) ?? byKind.set(f.kind, []).get(f.kind)!).push(f);
  for (const [kind, arr] of byKind) {
    console.log(`\n【⚠️要確認】${kind}: ${arr.length}件`);
    for (const f of arr.slice(0, 10)) console.log(`   - ${f.detail}`);
    if (arr.length > 10) console.log(`   … 他 ${arr.length - 10}件`);
  }
  console.log(
    findings.length === 0
      ? `\n==== 一次情報の突合: 要確認 0件（${checked}件を突合した上での0件） ====`
      : `\n==== 一次情報の突合: 要確認 ${findings.length}件（抜き取り ${checked}件中） ====`
  );

  // ── 検査自身の健全性（0件が「見た上での0」かを言えるようにする） ──
  const base = loadFactsBaseline();
  const problems: string[] = [];
  if (rows.length > 0 && checked === 0)
    problems.push(`突合対象 ${rows.length}件あるのに1件も本文を取れていない＝この検査は空振り（要確認0件に意味が無い）`);
  else if (base && base.checked >= 10 && checked < base.checked * 0.5)
    problems.push(`突合できた件数が ${base.checked} → ${checked}件に半減（収集元がブロックし始めた疑い。0件と同じで検査が痩せている）`);
  if (base && findings.length > base.findings)
    problems.push(`要確認が ${base.findings} → ${findings.length}件に増えた（増加は放置しない＝ラチェット）`);

  if (problems.length) {
    console.log("");
    for (const p of problems) console.log(`【❌ERROR】${p}`);
    console.log(
      `\n（中身を1件ずつ確認した上で正当だと判断したときだけ \`npm run audit:facts -- --update-baseline\` で受け入れる）`
    );
  }
  if (UPDATE_BASELINE) saveFactsBaseline({ checked, findings: findings.length });

  await prisma.$disconnect();
  if (problems.length) process.exitCode = 1;
}

main();
