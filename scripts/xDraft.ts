import fs from "node:fs";
import path from "node:path";
import { getItems } from "../src/lib/items";
import { getLotteryItems } from "../src/lib/seo";
import { cleanListTitle } from "../src/lib/title";
import { daysUntil, formatShort, todayJst } from "../src/lib/date";
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
const MAX_ROWS = 5; // 予算内に収まる範囲での上限。実際の行数は assemble が決める

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
  eventType: string;
};

/** 商品名は長いので行に収まる長さで落とす */
function shortTitle(source: string, title: string, max = 24): string {
  const t = cleanListTitle(source, title).replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function bullet(r: Row): string {
  return `・${r.eventDate ? formatShort(r.eventDate) : "受付中"} ${shortTitle(r.source, r.title)}`;
}

/**
 * 近い順に選ぶが、**切り詰めた後の表示名が同じ行**と**同じジャンルの偏り**を避ける。
 * 素直に上位から取ると「ONE PIECEカードゲーム ブースターパック 世…」が2行並ぶ（実測）。
 * 名前を切る以上、切った後の文字列で重複判定しないと意味がない。
 */
function pickVaried(rows: Row[], limit: number, withinDays: number): Row[] {
  const near = rows.filter((r) => {
    if (!r.eventDate) return true;
    const d = daysUntil(r.eventDate);
    return d >= 0 && d <= withinDays;
  });
  const pool = near.length >= limit ? near : rows;
  const seenName = new Set<string>();
  const seenGenre = new Set<string>();
  const out: Row[] = [];
  // 1巡目はジャンルを散らす。埋まらなければ2巡目で同ジャンルも許す。
  for (const pass of [0, 1]) {
    for (const r of pool) {
      if (out.length >= limit) break;
      const name = shortTitle(r.source, r.title);
      if (seenName.has(name)) continue;
      if (pass === 0 && seenGenre.has(r.genre)) continue;
      seenName.add(name);
      seenGenre.add(r.genre);
      out.push(r);
    }
  }
  return out;
}

/**
 * 見出しと締め文を先に確保し、**残り予算に収まる分だけ**商品行を足す。
 * 行数を決め打ちすると、商品名が長い日だけ 280 を超えて送信時に弾かれる
 * （実測 2026-08-18: 4行固定で 278/280 とほぼ余白が無かった）。
 */
function assemble(head: string, rows: Row[], tail: string): string {
  const body: string[] = [];
  for (const r of rows) {
    const next = [...body, bullet(r)];
    if (weightedLength([head, "", ...next, "", tail].join(NL)) > MAX_WEIGHTED - 6) break;
    body.push(bullet(r));
  }
  return body.length ? [head, "", ...body, "", tail].join(NL) : [head, "", tail].join(NL);
}

type Draft = { kind: string; note: string; text: string };

async function buildDrafts(): Promise<Draft[]> {
  const drafts: Draft[] = [];
  const lotteryIds = new Set<number>();

  // ① 抽選まとめ … 受付中/締切が近い抽選。ハツコレの一番強い面
  const lottery = (await getLotteryItems()) as unknown as Row[];
  if (lottery.length) {
    const picks = pickVaried(lottery, MAX_ROWS, 14);
    for (const r of picks) lotteryIds.add(r.id);
    drafts.push({
      kind: "lottery",
      note: `抽選 ${lottery.length}件から近い順に選出`,
      text: assemble("【抽選・受付中】応募忘れに注意", picks, `ほかの抽選もまとめています → ${SITE}/lottery`),
    });
  }

  // ② 今週の予定 … 抽選で出した商品は外す（同じ日に2本投げると中身がほぼ同じになる）
  const all = (await getItems({})) as unknown as Row[];
  const today = todayJst();
  const upcoming = all.filter(
    (r) => !lotteryIds.has(r.id) && r.eventDate != null && daysUntil(r.eventDate) >= 0 && daysUntil(r.eventDate) <= 7,
  );
  if (upcoming.length) {
    drafts.push({
      kind: "week",
      note: `今後7日 ${upcoming.length}件（抽選の分を除く）から選出`,
      text: assemble(
        `【今週の予定】${formatShort(today)}〜`,
        pickVaried(upcoming, MAX_ROWS, 7),
        `今週の分をまとめて見る → ${SITE}/`,
      ),
    });
  }

  // ③ 単品ピック … 画像を添えて投稿する想定
  const pick = upcoming[0] ?? all[0];
  if (pick) {
    drafts.push({
      kind: "pick",
      note: "単品ピック（画像を添えて投稿する想定）",
      text: [
        `${pick.eventDate ? formatShort(pick.eventDate) : "受付中"} ${cleanListTitle(pick.source, pick.title)}`,
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
