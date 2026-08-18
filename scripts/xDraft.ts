import fs from "node:fs";
import path from "node:path";
import { getItems } from "../src/lib/items";
import { getLotteryItems } from "../src/lib/seo";
import { cleanListTitle } from "../src/lib/title";
import { daysUntil, displayEventType, formatShort, todayJst } from "../src/lib/date";
import { buildPost, findForbidden, type DraftRow } from "../src/lib/xDraftText";
import { weightedLength, MAX_WEIGHTED } from "../src/lib/xApi";

// X用の下書きを、サイトが今見せているデータから組み立てる。
// **このスクリプトは投稿しない**（送るのは npm run x:post -- --file <path> --confirm だけ）。
//
// 文言の制約（[[System/rules]] ハツコレの立ち位置）:
//  ・相場・利益・プレ値・転売・せどり は使わない
//  ・訴求は「逃すと買えない」側＝予約開始 / 抽選 / 締切 / 受付中
//  ・収集元のサイト名は出さない。リンクは必ず自サイト（hatsukore.com）に向ける
//
// 使い方:
//   npm run x:draft                          … 全種類の下書きを表示
//   npm run x:draft -- --kind=lottery        … 種類を絞る（lottery / week / pick）
//   npm run x:draft -- --out drafts/a.txt    … 1本目をファイルへ（x:post に渡せる）

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://hatsukore.com";
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
  };
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
  // 長すぎる名前はここで落とす（下流で切らないため）
  const pool = (near.length >= limit ? near : rows).filter(
    (r) => displayName(r.source, r.title).length <= MAX_NAME,
  );
  const seenGenre = new Set<string>();
  const out: Row[] = [];
  for (const pass of [0, 1]) {
    for (const r of pool) {
      if (out.length >= limit) break;
      const name = displayName(r.source, r.title);
      if (used.has(name)) continue;
      if (pass === 0 && seenGenre.has(r.genre)) continue;
      used.add(name);
      seenGenre.add(r.genre);
      out.push(r);
    }
  }
  return out;
}

type Draft = { kind: string; note: string; text: string };

async function buildDrafts(): Promise<Draft[]> {
  const drafts: Draft[] = [];
  const used = new Set<string>();

  const today = todayJst();

  // ① 抽選。**種別が実際に「抽選」の行だけ**に絞る。
  // /lottery ページは hasLottery やタイトル一致でも拾うので、そのまま並べると
  // 「開催」「発売」が混ざり、見出しに『抽選』と書けなくなる（実測で混ざっていた）。
  const lotteryAll = (await getLotteryItems()) as unknown as Row[];
  const lottery = lotteryAll.filter(
    (r) => displayEventType(r.eventType, r.eventDate, r.eventDateText, today) === "抽選",
  );
  if (lottery.length) {
    const picks = pickVaried(lottery, MAX_ROWS, 14, used);
    drafts.push({
      kind: "lottery",
      note: `抽選ページ ${lotteryAll.length}件 → 種別が抽選の ${lottery.length}件から選出`,
      text: buildPost({
        rows: picks.map((r) => toDraftRow(r, today)),
        headBase: "抽選",
        tail: `ほかの抽選もまとめています → ${SITE}/lottery`,
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

  // ③ 単品ピック（画像を添えて投稿する想定）
  const pick = upcoming[0] ?? all[0];
  if (pick) {
    drafts.push({
      kind: "pick",
      note: "単品ピック（画像を添えて投稿する想定）",
      text: [
        `${pick.eventDate ? formatShort(pick.eventDate) : "受付中"} 【${displayEventType(pick.eventType, pick.eventDate, pick.eventDateText, today)}】`,
        cleanListTitle(pick.source, pick.title),
        "",
        "気になる人は早めにチェックを。",
        `${SITE}/items/${pick.id}`,
      ].join(NL),
    });
  }

  return drafts;
}

async function main() {
  const kind = arg("kind");
  const out = arg("out");
  const drafts = (await buildDrafts()).filter((d) => !kind || d.kind === kind);

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
  }

  if (out) {
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
