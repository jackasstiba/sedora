import fs from "node:fs";
import path from "node:path";
import { getItems } from "../src/lib/items";
import { getLotteryItems } from "../src/lib/seo";
import { cleanListTitle } from "../src/lib/title";
import { isTooGenericForImageSearch } from "../src/scrapers/imagePick";
import { parseStoresJson } from "../src/lib/stores";
import { daysUntil, displayEventType, formatShort, todayJst } from "../src/lib/date";
import { buildPost, buildLaunchPosts, findForbidden, findStaleNumbers, type DraftRow } from "../src/lib/xDraftText";
import { loadPostFacts, toFactCounts } from "../src/lib/xFacts";
import { weightedLength, MAX_WEIGHTED } from "../src/lib/xApi";

// X用の下書きを、サイトが今見せているデータから組み立てる。
// **このスクリプトは投稿しない**（送るのは npm run x:post -- --file <path> --confirm だけ）。
//
// 文言の制約（[[System/rules]] ハツコレの立ち位置）:
//  ・相場・利益・プレ値・転売・せどり は使わない
//  ・訴求は「逃すと買えない」側＝予約開始 / 抽選 / 締切 / 受付中
//  ・収集元のサイト名は出さない。リンクは必ず自サイト（hatsukore.com）に向ける
//
//  ・本文に書く数（掲載件数・収集元の数）は**手で書かない**。実データから入れる
//    （2026-08-19 実測: 手書きの告知文が 2,139件/26情報源 のまま、実データは 1,873件/24 だった）
//
// 使い方:
//   npm run x:draft                          … 全種類の下書きを表示
//   npm run x:draft -- --kind=lottery        … 種類を絞る（lottery / week / pick / launch_*）
//   npm run x:draft -- --out drafts/a.txt    … 1本目をファイルへ（x:post に渡せる）
//   npm run x:draft -- --outdir=drafts       … 表示した全種類を drafts/<種類>.txt へ書き出す

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://hatsukore.com";
/** 選んだ行のリンク先を実際に取得して根拠を出す（投稿前に必ず通す） */
const WANT_EVIDENCE = process.argv.includes("--evidence");
const NL = String.fromCharCode(10);
const MAX_ROWS = 6;

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=").slice(1).join("=");
}

type Row = {
  id: number;
  source: string;
  title: string;
  genre: string;
  eventDate: Date | null;
  eventDateText: string | null;
  eventType: string;
  url: string;
  stores: string | null;
};

/**
 * DBの行を投稿用の行に変換する。**種別はサイトと同じ displayEventType を通す**
 * （別実装にすると画面と投稿がズレる。過去日の「予定」も同じ規則で過去形になる）。
 */
function toDraftRow(r: Row, today: Date): DraftRow {
  return {
    name: displayName(r.source, r.title),
    type: displayEventType(r.eventType, r.eventDate, r.eventDateText, today),
    dateLabel: r.eventDate ? formatShort(r.eventDate) : null,
    // 日付が無い行は**収集元の文言をそのまま**使う。「受付中」と決めつけない
    // （"受付終了（直近 7/1）" の行が実在する）。文言も無ければ載せない。
    noDateLabel: r.eventDate ? undefined : (r.eventDateText ?? undefined),
  };
}

/**
 * 「抽選」の行で eventDate が**応募締切**だと言い切れる収集元。
 *
 * eventDate の意味は収集元ごとに違う（2026-08-19 に実装を1本ずつ確認した）:
 *  ・card_chusen … `lastDeadline()`＝**全店が締め切る日**。個々の店の締切ではない
 *  ・raffle_kuji … 応募締切日
 *  ・mita_draw   … 応募締切
 *  ・nyuka_now   … 「締切**または開始**日のうち今日以降で最短」＝締切と言い切れない → 対象外
 *  ・sofvi       … 日付の意味が実装から確定できない → 対象外
 * 「8/19(水)」とだけ書くと、受付開始なのか締切なのか読み手に分からない（本人の指摘）。
 */
const DEADLINE_SOURCES = new Set(["card_chusen", "raffle_kuji", "mita_draw"]);

/**
 * 🚨 **応募先が1つに定まっている行しか投稿に載せない**（2026-08-19 実測）。
 *
 * card_chusen の1行は複数店をまとめており、締切が店ごとに違う。実例 #75419
 * 「スタートデッキ100 バトルコレクション」は **17店・8/18〜8/25**。この行に日付を1つ
 * 書くと、どう書いても嘘になる（最短を書けば他店をまだ応募できるのに終わったと言い、
 * 最後を書けば締切済みの店を応募できると言う）。さらに item.url は「締切が近い順」の
 * 先頭を指すので、**すでに締切済みの店**を指していることがある（実測5件）。
 *
 * よって「締切が入っていて、今日時点で受付中の店がちょうど1つ」の行だけを候補にする。
 * 候補になっても、リンク先の実物を読んで裏を取るまで投稿しない（--evidence）。
 */
function soleOpenStore(
  storesJson: string | null,
  today: Date,
): { url: string; name: string; due: Date; whenText: string | null } | null {
  const st = parseStoresJson(storesJson);
  if (!st || st.length !== 1) return null;
  const s = st[0];
  if (!s.at || s.kind !== "締切" || !s.url) return null;
  const due = new Date(`${s.at}T00:00:00.000Z`);
  if (due.getTime() < today.getTime()) return null;
  return { url: s.url, name: s.name, due, whenText: s.when };
}

/** 商品名は**切らない**（切ると何の商品か分からず、並べる意味が無くなる） */
function displayName(source: string, title: string): string {
  return cleanListTitle(source, title).replace(/\s+/g, " ").trim();
}

/** 1行が長すぎる商品は載せない。切るのではなく**選ばない**ことで途切れを無くす。 */
const MAX_NAME = 34;

/**
 * 近い順に選ぶが、**表示名の重複**と**同じジャンルの偏り**を避ける。
 * used は下書きをまたいで共有する（別idでも同じ商品名の行が実在するので id では防げない）。
 */
function pickVaried(rows: Row[], limit: number, withinDays: number, used: Set<string>): Row[] {
  const near = rows.filter((r) => {
    if (!r.eventDate) return true;
    const d = daysUntil(r.eventDate);
    return d >= 0 && d <= withinDays;
  });
  // 長すぎる名前はここで落とす（下流で切らないため）。あわせて
  // **商品を特定していない名前**も落とす（実測: 「ポケモンカードゲーム関連商品」が並んでいた。
  // 読み手には何のことか分からず、リンク先も期待と違う）。判定は画像側と同じ関数を使う
  // ＝「作品名＋種別だけ」の名前は借り物の写真も付けない、と同じ基準。
  const pool = (near.length >= limit ? near : rows).filter((r) => {
    const name = displayName(r.source, r.title);
    return name.length <= MAX_NAME && !isTooGenericForImageSearch(name);
  });
  const seenGenre = new Set<string>();
  const out: Row[] = [];
  for (const pass of [0, 1]) {
    for (const r of pool) {
      if (out.length >= limit) break;
      const name = displayName(r.source, r.title);
      if (used.has(name)) continue;
      // 完全一致だけ弾いても、実物は「…スターターセットex」と「…スターターセットex イーブイex」
      // のように**枝番違いが並ぶ**（2026-08-19 実測。2行とも同じ商品に見える）。
      if (out.some((o) => sameHead(displayName(o.source, o.title), name))) continue;
      if (pass === 0 && seenGenre.has(r.genre)) continue;
      used.add(name);
      seenGenre.add(r.genre);
      out.push(r);
    }
  }
  return out;
}

/** 先頭が十分に一致していれば「読み手には同じ商品」とみなす */
const SAME_HEAD_CHARS = 12;
function sameHead(a: string, b: string): boolean {
  return a.slice(0, SAME_HEAD_CHARS) === b.slice(0, SAME_HEAD_CHARS);
}

type Evidence = { label: string; url: string; verdict: string; quote: string };
type Draft = { kind: string; note: string; text: string; evidence?: Evidence[] };

/**
 * 選んだ行のリンク先を**実際に取得して**、締切の記載を抜き出す（`--evidence`）。
 *
 * 2026-08-19: 下書きの数と種別は機械で守ったが、**その日付が一次情報に本当に
 * 書いてあるか**は誰も見ていなかった（audit:facts は「日付は書式が多様」と明記して
 * 判定を放棄している）。結果、リンク先が8/18に締め切った店の行を投稿しかけた。
 * 機械は「読むべき箇所」をここまで運ぶ。**最後に人が読む**（自動で通す判定にはしない）。
 */
async function collectEvidence(
  rows: { title: string; due: Date; url: string; store: string }[],
): Promise<Evidence[]> {
  const strip = (h: string) =>
    h
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ");
  const out: Evidence[] = [];
  for (const r of rows) {
    const label = `${formatShort(r.due)} ${r.title}（${r.store}）`;
    try {
      const res = await fetch(r.url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; hatsukore-verify/1.0)" },
      });
      const text = strip(await res.text());
      const m = r.due.getUTCMonth() + 1;
      const d = r.due.getUTCDate();
      const forms = [`${m}/${d}`, `${m}月${d}日`, `${m}.${String(d).padStart(2, "0")}`];
      const at = forms.map((f) => text.indexOf(f)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
      const quote =
        at != null && at >= 0
          ? text.slice(Math.max(0, at - 60), at + 60)
          : text.slice(0, 120);
      out.push({
        label,
        url: r.url,
        verdict:
          res.status !== 200
            ? `❌ HTTP ${res.status}（読めない＝裏が取れない）`
            : at == null
              ? "❌ 締切の日付がリンク先の本文に見つからない"
              : "🔎 日付の記載あり（前後を読んで確認すること）",
        quote,
      });
    } catch (e) {
      out.push({ label, url: r.url, verdict: `❌ 取得失敗: ${e instanceof Error ? e.message : e}`, quote: "" });
    }
  }
  return out;
}

async function buildDrafts(): Promise<Draft[]> {
  const drafts: Draft[] = [];
  const used = new Set<string>();

  const today = todayJst();

  // ① 抽選。**種別が実際に「抽選」の行だけ**に絞る。
  // /lottery ページは hasLottery やタイトル一致でも拾うので、そのまま並べると
  // 「開催」「発売」が混ざり、見出しに『抽選』と書けなくなる（実測で混ざっていた）。
  // さらに **eventDate が応募締切だと言い切れる収集元**かつ**応募先が1つに定まる行**だけ。
  const lotteryAll = (await getLotteryItems()) as unknown as Row[];
  const lottery = lotteryAll
    .filter(
      (r) =>
        displayEventType(r.eventType, r.eventDate, r.eventDateText, today) === "抽選" &&
        DEADLINE_SOURCES.has(r.source) &&
        soleOpenStore(r.stores, today) != null,
    )
    // 日付は eventDate（＝全店が締め切る日）ではなく、**その1店の締切**を使う
    .map((r) => ({ ...r, eventDate: soleOpenStore(r.stores, today)!.due }));
  if (lottery.length) {
    // 締切の近い順（見出しでそう名乗る以上、選んだ後に並べ直す）
    const picks = pickVaried(lottery, MAX_ROWS, 14, used).sort(
      (a, b) => (a.eventDate?.getTime() ?? 0) - (b.eventDate?.getTime() ?? 0),
    );
    drafts.push({
      kind: "lottery",
      note: `抽選ページ ${lotteryAll.length}件 → 応募先が1つに定まる ${lottery.length}件から選出`,
      evidence: WANT_EVIDENCE
        ? await collectEvidence(
            picks.map((r) => {
              const s = soleOpenStore(r.stores, today)!;
              return { title: displayName(r.source, r.title), due: s.due, url: s.url, store: s.name };
            }),
          )
        : undefined,
      text: buildPost({
        // 日付の意味は**見出しで言い切る**（記号や凡例に頼ると、行だけ読んだ人には
        // 受付開始日に見える。本人の指摘 2026-08-19）。
        rows: picks.map((r) => toDraftRow(r, today)),
        headBase: "抽選",
        headNote: "応募締切",
        tail: `締切の近い順にまとめています → ${SITE}/lottery`,
        weigh: weightedLength,
        budget: MAX_WEIGHTED - 6,
      }).text,
    });
  }

  // ② 発売・予約の予定
  const all = (await getItems({})) as unknown as Row[];
  const upcoming = all.filter(
    (r) => r.eventDate != null && daysUntil(r.eventDate) >= 0 && daysUntil(r.eventDate) <= 7,
  );
  if (upcoming.length) {
    const picks = pickVaried(upcoming, MAX_ROWS, 7, used);
    drafts.push({
      kind: "week",
      note: `今後7日 ${upcoming.length}件から選出`,
      text: buildPost({
        rows: picks.map((r) => toDraftRow(r, today)),
        headBase: "今日の予定",
        tail: `日付順にまとめています → ${SITE}/`,
        weigh: weightedLength,
        budget: MAX_WEIGHTED - 6,
      }).text,
    });
  }

  // ③ 単品ピック（画像を添えて投稿する想定）。
  // **日付のある行からしか選ばない**（日付が無い行を「受付中」と書けないため。同上）。
  const pick = upcoming[0] ?? all.find((r) => r.eventDate != null);
  if (pick) {
    drafts.push({
      kind: "pick",
      note: "単品ピック（画像を添えて投稿する想定）",
      text: [
        `${formatShort(pick.eventDate!)} 【${displayEventType(pick.eventType, pick.eventDate, pick.eventDateText, today)}】`,
        cleanListTitle(pick.source, pick.title),
        "",
        "気になる人は早めにチェックを。",
        `${SITE}/items/${pick.id}`,
      ].join(NL),
    });
  }

  // ④ 初回告知（固定ポスト用）。**数はここで実データから入る**ので手書きの腐りが起きない。
  const facts = await loadPostFacts();
  for (const p of buildLaunchPosts({
    items: facts.items,
    sources: facts.sources,
    within7: facts.within7,
    site: SITE,
  })) {
    drafts.push(p);
  }

  return drafts;
}

async function main() {
  const kind = arg("kind");
  const out = arg("out");
  const outdir = arg("outdir");
  const drafts = (await buildDrafts()).filter((d) => !kind || d.kind === kind);
  const counts = toFactCounts(await loadPostFacts());

  if (drafts.length === 0) {
    console.log("下書きを作れる材料がありませんでした（該当データなし）。");
    return;
  }

  for (const d of drafts) {
    const len = weightedLength(d.text);
    console.log("=".repeat(60));
    console.log(`[${d.kind}] ${d.note}`);
    console.log("-".repeat(60));
    console.log(d.text);
    console.log("-".repeat(60));
    console.log(`重み付き文字数: ${len} / ${MAX_WEIGHTED}${len > MAX_WEIGHTED ? "  ❌ 超過" : ""}`);
    const ng = findForbidden(d.text);
    if (ng.length) console.log(`❌ 立ち位置に反する語: ${ng.join(" / ")}`);
    // 自分で組み立てた本文も、送る側と同じ物差しに通す（片方だけ直すとすり抜ける）
    const stale = findStaleNumbers(d.text, counts);
    if (stale.length) console.log(`❌ 数が実データと合わない: ${stale.join(" / ")}`);
    if (d.evidence?.length) {
      console.log(`${NL}── 一次情報（この行を投稿してよいかは、ここを読んで決める）──`);
      for (const e of d.evidence) {
        console.log(`  ${e.verdict}  ${e.label}`);
        console.log(`     ${e.url}`);
        if (e.quote) console.log(`     …${e.quote}…`);
      }
    }
  }

  if (outdir) {
    fs.mkdirSync(outdir, { recursive: true });
    for (const d of drafts) {
      const p = path.join(outdir, `${d.kind}.txt`);
      fs.writeFileSync(p, d.text + NL, "utf8");
      console.log(`📝 ${p}`);
    }
    console.log(`${NL}送るときは npm run x:post -- --file <path> （--confirm で実投稿）`);
  } else if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, drafts[0].text, "utf8");
    console.log(`${NL}📝 ${out} に保存しました。送るときは:`);
    console.log(`   npm run x:post -- --file ${out}            （まず内容確認）`);
    console.log(`   npm run x:post -- --file ${out} --confirm  （実際に投稿）`);
  } else {
    console.log(`${NL}🟡 下書きを表示しただけです。投稿はしていません。`);
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(`❌ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
