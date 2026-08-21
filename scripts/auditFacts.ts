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
 *   ・日付が本文にあるか       … **暦日として取り出して比べれば判定できる**（2026-08-19 に実装）。
 *                                 ただし鳴らすのは「こちらの日付が一次情報のどこにも無い」ときだけの片側の網。
 * よって指摘するのは「識別語が1つも出ない」「価格が本文に無い」「日付がどこにも無い」に絞り、
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
import { baselineWritable } from "./factsBaseline";
import { cleanListTitle } from "../src/lib/title";
import { normalizeForSearch } from "../src/lib/itemFilter";
import { franchiseAliases } from "../src/lib/franchise";
import { identityTokens, pageShowsProduct } from "../src/lib/identity";
import { parseYen } from "../src/lib/margin";
import { datesInclude, extractDates } from "../src/lib/dateText";
import { isMonthPrecision, jstCalDate } from "../src/lib/date";
import { parseStoresJson } from "../src/lib/stores";
import { fetchPopmartCalendar, type PopmartCalendarItem } from "../src/scrapers/popmart";

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
// 基準に書いてよい回かの判定は factsBaseline.ts（純関数・selftest対象）。
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

// 識別語の作り方と一致判定は src/lib/identity.ts（取り込み側 cardChusen と同じ物差しを使う）。

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

// popmart のカレンダー（sourceId → API行）。1回だけ取り、失敗したら空のまま＝
// 全行「窓の外」扱い（unusable）になるだけで、検査自体は落とさない。
let popmartCalCache: Map<string, PopmartCalendarItem> | null = null;
async function popmartCalendarById(): Promise<Map<string, PopmartCalendarItem>> {
  if (popmartCalCache) return popmartCalCache;
  try {
    popmartCalCache = new Map((await fetchPopmartCalendar()).map((p) => [p.id, p]));
  } catch {
    popmartCalCache = new Map();
  }
  return popmartCalCache;
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

      // popmart はページHTMLに商品情報が一切無い（RSCストリーミングのSPA。存在しないURLでも
      // 同じ見た目の200が返る）。ここを本文検査に流すと「価格が本文に無い」が**構造的に毎回鳴る**
      // （実測 2026-08-21: 3件＝読めていないことを根拠にした指摘。takaratomy_mall で通った道と同じ）。
      // popmart の一次情報は店のAPIそのものなので、**APIの現在値と突合する**＝取り込み後に
      // 店側が価格・日付を変えた（こちらが陳腐化した）ことを検出する本物の検査になる。
      if (source === "popmart") {
        const cal = await popmartCalendarById();
        const p = cal.get(r.sourceId);
        if (!p) {
          // カレンダーの窓（直近約1ヶ月）から流れた行。裏取り先が無くなっただけで誤りの証拠ではない。
          unusable++;
          continue;
        }
        checked++;
        const name = cleanListTitle(r.source, r.title);
        const apiPrice = p.price ? `${p.price.toLocaleString()}円` : null;
        if (r.price && apiPrice && r.price !== apiPrice)
          findings.push({
            kind: "価格が一次情報と食い違う",
            detail: `[popmart #${r.id}] 掲載 ${r.price} ↔ API ${apiPrice} ${name.slice(0, 40)}`,
          });
        const apiDate = p.saleStartAt ? jstCalDate(Date.parse(p.saleStartAt)) : null;
        if (r.eventDate && apiDate && r.eventDate.getTime() !== apiDate.getTime())
          findings.push({
            kind: "日付が一次情報と食い違う",
            detail: `[popmart #${r.id}] 掲載 ${r.eventDate.toISOString().slice(0, 10)} ↔ API ${apiDate
              .toISOString()
              .slice(0, 10)} ${name.slice(0, 40)}`,
          });
        continue;
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
      const matched = pageShowsProduct(text, title);
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

      // (3) 日付が一次情報に書かれているか。
      //
      // 2026-08-19 まで、ここは **substring で数えるだけの参考値** だった（「書式が多様だから
      // 判定に耐えない」）。だが日付はこのサイトが一番強く言い切る値で、間違えると読者は
      // 応募・発売を逃す。実際、投稿の下書きを作った日に「日付だけ裏が取れていない」ことが
      // 露見した。substring が弱いのは**比べ方**が悪いからで、暦日として取り出してから
      // 比べれば判定できる（src/lib/dateText.ts）。
      //
      // ⚠️ **片側の網**にする。鳴らすのは「こちらの日付が一次情報のどこにも無い」ときだけ。
      // 一覧・カレンダーのように日付が大量に載るページでは偶然一致して見逃す（＝感度は落ちる）が、
      // それは誤報より安い。誤報する検査は本物を埋もれさせる（ENDED_WORDS で実測済み）。
      // **通販の商品ページ・検索結果は日付の一次情報ではない**ので対象外にする。
      // 抽選日・再販日を告知しているのは収集元の記事や応募ページであって、通販の棚ではない。
      // 実測 2026-08-19/20 の誤報2件:
      //   ・楽天検索 … 並ぶ「08/20・9/10」等はお届け日や別商品の日付
      //   ・Amazon の商品ページ … 本文の日付は**全部レビュー日**（「2026年3月9日に日本で
      //     レビュー済み」）。何を載せても掲載日付と一致しないので、必ず鳴る＝ただの雑音。
      // 読めないものを根拠に指摘しない（価格の判定で通った道と同じ）。
      const urlIsMarketplace = urlIsSearchPage || /amazon\.co\.jp\/(?:dp|gp\/product)\//.test(r.url);
      if (r.eventDate && !isMonthPrecision(r.eventDateText) && !urlIsMarketplace) {
        // 商品がそのページに載っていない行は、日付ではなく**リンクが違う**問題。
        // (1) が既に指摘しているので二重に鳴らさない。
        const pageDates = matched ? extractDates(text) : [];
        if (pageDates.length) {
          dateTotal++;
          // 1つの行が複数の応募先を束ねている場合（card_chusen は最大17店・締切がばらける）、
          // 画面の日付は「全店が締め切る日」で、リンク先は**その中の1店**。店の締切と
          // 食い違って当然なので、**この行が画面に出しているどれかの日付**に当たれば一致とみなす。
          // 締切だけでなく**受付開始**も入れる（実測 2026-08-20: #92509 のリンク先は
          // その店の応募フォームで、載っているのは開始日 2026/08/21 のほうだった＝誤報）。
          const candidates = [new Date(r.eventDate)];
          for (const s of parseStoresJson(r.stores) ?? [])
            if (s.at) candidates.push(new Date(`${s.at}T00:00:00.000Z`));
          if (candidates.some((c) => datesInclude(pageDates, c))) dateHit++;
          else
            findings.push({
              kind: "日付が一次情報に見当たらない",
              detail:
                `[${source} #${r.id}] 掲載 ${new Date(r.eventDate).toISOString().slice(0, 10)}` +
                `${candidates.length > 1 ? `（応募先の日付 ${candidates.length - 1}件を含めても不一致）` : ""}` +
                ` ↔ 一次情報の日付 ${[...new Set(pageDates.map((p) => p.raw))].slice(0, 6).join("・")}` +
                ` ${title.slice(0, 30)} → ${r.url}`,
            });
        }
      }
      await new Promise((s) => setTimeout(s, 300));
    }
  }

  console.log(
    `突合できたページ ${checked}件 / 本文を取れず判定不能 ${unusable}件 / 画像を確かめた ${imageChecked}件 / ` +
      `日付を突合できた ${dateTotal}件のうち一致 ${dateHit}件`
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
  // 痩せた回を基準にしない（2026-08-19 実測）。同じ日に2回全件を回したら、1回目は
  // 判定不能24件/突合844件、2回目は**判定不能198件(23%)/突合670件**だった（こちらから
  // 叩きすぎて収集元が絞り始めた）。2回目の要確認は15件＝1件少ないが、それは**直ったのではなく
  // 読めなかった**だけ。この回を `--update-baseline` で受け入れると、**基準が痩せた側に固定され、
  // 次に正常な回が来たときに「増えた」と鳴る**。しかも基準そのものは静かに緩む。
  //
  // 比較側には「突合できた件数が半減」の歯止めが既にあるのに、**書き込み側には無かった**。
  // 守りを1か所に入れて隣の同型を見落とす型（ミス33・34と同じ）。
  const writable = baselineWritable(checked, unusable);
  if (UPDATE_BASELINE && !writable.ok) {
    console.log(
      `\n【❌ERROR】本文を取れなかった割合が ${Math.round(writable.rate * 100)}%（${unusable}/${checked + unusable}）。` +
        `\n この回は痩せているので baseline に書かない。時間を置いてから回し直すこと。`
    );
    process.exitCode = 1;
  } else if (UPDATE_BASELINE) {
    saveFactsBaseline({ checked, findings: findings.length });
  }

  await prisma.$disconnect();
  if (problems.length) process.exitCode = 1;
}

main();
