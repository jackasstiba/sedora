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
import { isOfficialUrl } from "../src/lib/outbound";
import { cleanListTitle } from "../src/lib/title";
import { normalizeForSearch } from "../src/lib/itemFilter";
import { franchiseAliases } from "../src/lib/franchise";
import { parseYen } from "../src/lib/margin";

// 本文の代わりにログイン壁・同意画面を返すホスト。文字数は十分あるので「本文が取れた」と
// 誤認し、識別語が1つも出ない＝要確認、という**中身を見ていない誤報**になる（実測: x_watch の
// item.url は投稿ではなくアカウントページで、そもそも画面にも出していないリンクだった）。
// 判定材料にならないものは「判定不能」に数える。0件と誤報は違う。
const WALLED_HOSTS = /(^|\.)(x\.com|twitter\.com)$/i;

/** これ未満は本文ではなく「JSで描く前の殻」とみなす（実測: p-bandai は1字） */
const SHELL_CHARS = 120;

const args = process.argv.slice(2);
const perIdx = args.indexOf("--per-source");
const PER_SOURCE = perIdx >= 0 ? Number(args[perIdx + 1]) || 3 : 3;
const srcIdx = args.indexOf("--source");
const ONLY_SOURCE = srcIdx >= 0 ? args[srcIdx + 1] : null;
const UPDATE_BASELINE = args.includes("--update-baseline");
// **外にリンクを出している行だけ全件**突合するモード。抜き取り(--per-source)では
// 「そのリンクが商品を指しているか」がほぼ見えない（2026-08-19 実測: 抜き取りは要確認0件
// だったが、抽選108件を全件当てたら 14件(13%) がリンク先に商品名の語を1つも持たなかった
// ＝ヤマダの会員説明ページ／ドラゴンボールの行が遊戯王のXポスト、など）。
// リンクは「ここで買える・応募できる」という約束なので、約束している行は全部見る。
const LINKED_ALL = args.includes("--linked-all");

// ── この検査自身が空振り・後退していないか ─────────────────────────────────
// 2026-08-09 実測: このスクリプトは **1件も突合できなくても「要確認 0件」と出して exit 0**
// だった（`--source zzz` で再現）。run_scrape.bat はこれを関門として呼んでいるので、
// 構造上ぜったいに失敗しない関門＝無いのと同じだった。昨日 audit.ts で潰した
// 「見た上での0か、何も見ていない0か」がここだけ手つかずで残っていた（[[System/rules]]）。
// さらに指摘件数のラチェットも無く、要確認が 0→15 に増えても誰も止めない（WARN放置の再来）。
// ラチェットの保管先は audit-baseline.json に揃える（監査の基準はこのファイル、という約束）。
const BASELINE_PATH = path.join(process.cwd(), "audit-baseline.json");
type FactsBaseline = { checked: number; findings: number };
// 抜き取りと全件では母数が桁違いなので、ラチェットの基準も別に持つ
// （混ぜると「突合できた件数が半減」が毎回鳴る）。
function baselineKey(): "facts" | "factsLinked" {
  return LINKED_ALL ? "factsLinked" : "facts";
}
function loadFactsBaseline(): FactsBaseline | null {
  try {
    return (JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"))[baselineKey()] as FactsBaseline) ?? null;
  } catch {
    return null;
  }
}
function saveFactsBaseline(next: FactsBaseline) {
  const cur = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
  cur[baselineKey()] = next;
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

/** ヘッダ → HTML先頭の meta charset の順に見て復号する（scrapers/util.ts と同じ手順）。 */
function decodeBody(buf: Buffer, contentType: string | null): string {
  const fromHeader = (contentType ?? "").match(/charset=["']?([\w-]+)/i)?.[1];
  const fromMeta = buf.subarray(0, 3000).toString("latin1").match(/charset=["']?([\w-]+)/i)?.[1];
  const label = (fromHeader ?? fromMeta ?? "utf-8").toLowerCase().replace(/^x-/, "").replace(/^sjis$/, "shift_jis");
  try {
    return new TextDecoder(label).decode(buf);
  } catch {
    return buf.toString("utf8");
  }
}

/** 突合に使う本文。`text` は <title> 込み（同一性の判定用）、`body` は本文だけ（価格の判定用） */
async function pageText(url: string): Promise<{ text: string; body: string } | null> {
  try {
    if (WALLED_HOSTS.test(new URL(url).hostname)) return null;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SedoriRadar-audit/1.0)" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    // **文字コードを見てから復号する。** `res.text()` は charset が無いと UTF-8 と決め打つので、
    // Shift_JIS で配信している一次ストア（タカラトミーモール）の本文が丸ごと文字化けし、
    // 識別語が1つも見つからない＝「リンク先に商品が見当たらない」という**嘘の指摘**が出る
    // （実測 2026-08-18: #92255/#92355 の2件。実際にはページに商品名がある）。
    // スクレイパー側は fetchHtmlDetectCharset で既に対処済みで、**検査側だけが素の text() の
    // ままだった**＝検査が誤報を出す側に回っていた。
    const $ = cheerio.load(decodeBody(Buffer.from(await res.arrayBuffer()), res.headers.get("content-type")));
    $("script, style, noscript").remove();
    // 🚨 `<body>` だけを見ると**商品名がタイトルにしか無いページ**を「商品が見当たらない」と
    // 誤報する（実測 2026-08-19: タカラトミーモールの商品ページは body がナビだけで、
    // 「LittleArmory リトルアーモリー LD030 ゾンビハンターセットA」は <title> にしか無い。
    // 6件が誤報として上がっていた）。商品名がいちばん確実に載っているのは <title> と og:title。
    const head = [
      $("title").text(),
      $('meta[property="og:title"]').attr("content") ?? "",
      $('meta[name="description"]').attr("content") ?? "",
      $('meta[property="og:description"]').attr("content") ?? "",
    ].join(" ");
    const body = $("body").text().replace(/\s+/g, " ");
    const t = `${head} ${body}`.replace(/\s+/g, " ").trim();
    // 本文が極端に短いページ＝**JSで描く殻**（<SHELL_CHARS）は判定材料にならないので除外する。
    //
    // 🚨 ここは 500字で切っていた（2026-08-19 まで）。ところが**一番壊れているリンクほど
    // 本文が短い**: ヤマダの「デジタル会員」説明ページ（本文476字・商品名は一切無い）を
    // 指していた2件が、短いという理由で「判定不能」に落ちて検査から消えていた。
    // 短いページは「判定できない」のではなく「中身が無い」＝指摘すべき側なので、
    // 殻（ほぼ空）とだけ区別する。長さは detail に出して、人が短さを見て判断できるようにする。
    if (t.length < SHELL_CHARS) return null;
    return { text: normalizeForSearch(t), body: normalizeForSearch(body) };
  } catch {
    return null;
  }
}

type Finding = { kind: string; detail: string };

// リンク先が「終了」と書いている行。**指摘にはしない・参考として人に渡すだけ。**
//
// 2026-08-19 に距離で判定できないか実測した:
//   ・livepocket（本当に販売終了）… 商品語と「販売終了」の最近接 241字
//   ・福福トレカ（実際は受付中）  … 同じ商品名が受付中の節と終了済みの節の両方に出るため
//                                   最近接 16字。**誤報の方が近い**
// 近さでも共起でも分けられないので、断定する検査にはしない（誤報する検査は本物を埋もれさせる）。
// 数と行だけ出して、人が実物を読んで決める。
const ENDED_WORDS = ["受付終了", "応募終了", "販売終了", "抽選終了", "終了しました", "受付は終了"];

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
  const endedRows: string[] = [];
  let checked = 0;
  let unusable = 0;
  let dateHit = 0;
  let dateTotal = 0;
  let imageChecked = 0;

  console.log(
    LINKED_ALL
      ? "== ハツコレ 一次情報の突合 == (外にリンクを出している行を全件)"
      : `== ハツコレ 一次情報の突合 == (ソースごと ${PER_SOURCE}件)`
  );

  for (const [source, arr] of bySource) {
    // --linked-all: 画面が item.url を外部リンクとして出している収集元は**全件**見る。
    // それ以外は決定的に散らす（毎回同じ先頭だけを見ると、同じページしか検査しない）。
    const step = Math.max(1, Math.floor(arr.length / PER_SOURCE));
    const sample = LINKED_ALL
      ? isOfficialUrl(source)
        ? arr
        : []
      : arr.filter((_, i) => i % step === 0).slice(0, PER_SOURCE);
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

      const page = await pageText(r.url);
      if (!page) {
        unusable++;
        continue;
      }
      const { text, body } = page;
      checked++;
      // 本文が薄いページは、それ自体が「商品ページではない」手がかりになる。
      const thin = text.length < 500;
      const title = cleanListTitle(r.source, r.title);
      const toks = identityTokens(title);

      const endedHit = ENDED_WORDS.filter((w) => text.includes(normalizeForSearch(w)));
      if (endedHit.length)
        endedRows.push(`[${source} #${r.id}] ${cleanListTitle(r.source, r.title).slice(0, 40)}（${endedHit.slice(0, 2).join("・")}）→ ${r.url}`);

      // (1) 同一性: 識別語が2つ以上あるのに1つも本文に出てこない＝別物か陳腐化。
      //     ただし作品名は日英・カナで表記が割れる（こちらが「ONE PIECE カードゲーム」、
      //     一次情報は「ワンピースカードゲーム」＝正しいリンクなのに要確認になっていた）。
      //     既にある作品エイリアス表を同一性の判定にも通す。
      const aliases = franchiseAliases(title).map(normalizeForSearch);
      const matched = toks.some((k) => text.includes(k)) || aliases.some((a) => text.includes(a));
      // 本文（<title> を除く）にも商品名が出ているか。価格の判定はこれが真のときだけ行う。
      const matchedInBody = toks.some((k) => body.includes(k)) || aliases.some((a) => body.includes(a));
      if (toks.length >= 2 && !matched) {
        findings.push({
          kind: "リンク先に商品が見当たらない",
          detail:
            `[${source} #${r.id}] 識別語 ${toks.join(" / ")} がどれも本文に無い` +
            `${thin ? `（本文${text.length}字＝商品ページではない疑い）` : ""} → ${r.url}`,
        });
      }

      // (2) 価格: 手元の定価が本文のどこにも出てこない。
      //     ただし**リンク先が検索結果ページのソース**（gunpla_resale等＝収集元非公開で
      //     楽天検索を導線にしている）は対象外。検索結果に並ぶのは出品者の実売価格で、
      //     カタログ定価が載っている保証がそもそも無い＝この検査の前提（リンク先＝価格の
      //     一次情報）が成り立たない。実測: HGUC ボール 定価1,760円が検索結果に無く誤報。
      const urlIsSearchPage = /search\.rakuten\.co\.jp|shopping\.yahoo\.co\.jp\/search|amazon\.co\.jp\/s\b/.test(r.url);
      const yen = !urlIsSearchPage && r.price ? parseYen(r.price.split(" / ")[0]) : null;
      // 価格は**本文が実際に読めたページ**でしか見ない。商品名がタイトルにしかない＝
      // 中身をJSで描くページでは、価格も当然HTMLに無い。それを「一次情報に価格が無い」と
      // 言うのは、読めていないことを根拠にした指摘になる（実測: takaratomy_mall 6件）。
      if (yen != null && yen > 0 && matchedInBody) {
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

  if (endedRows.length) {
    console.log("");
    console.log(`【👀参考・判定していない】リンク先に終了の語がある: ${endedRows.length}件`);
    console.log("   ※ 同じ商品名が受付中と終了済みの両方に出るページがあるので、機械では決められない。");
    console.log("   ※ 実物を読んで、本当に終わっているものだけ手当てする。");
    for (const r of endedRows.slice(0, 15)) console.log(`   - ${r}`);
    if (endedRows.length > 15) console.log(`   … 他 ${endedRows.length - 15}件`);
  }

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
