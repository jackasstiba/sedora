/**
 * データ品質の常設監査（`npm run audit`）。
 *
 * 目的: 「人間なら一瞬で気付く表記/数字/日付の粗」を、その都度目視で探すのではなく、
 * サイトの表示スコープ全件に対して不変条件（invariant）を毎回機械チェックする。
 * スクレイプ後に回す想定（run_scrape.bat / 手動）。違反は種類ごとに件数＋サンプルを出す。
 *
 * 追加した観点はここに invariant を足す＝「全方位チェック」を仕組みとして育てる場所。
 */
import { prisma } from "../src/lib/prisma";
import { todayJst } from "../src/lib/date";
import { cleanListTitle } from "../src/lib/title";
import { dedupeItems, dedupeKey } from "../src/lib/itemFilter";
import { parseYen } from "../src/lib/margin";

type Row = Awaited<ReturnType<typeof fetchRows>>[number];

async function fetchRows() {
  const today = todayJst();
  return prisma.item.findMany({
    where: { OR: [{ eventDate: { gte: today } }, { eventDate: null }] },
    take: 6000,
  });
}

type Finding = { title: string; detail: string; samples: string[]; level: "error" | "warn" };
const findings: Finding[] = [];
function report(title: string, level: "error" | "warn", items: string[], cap = 8) {
  if (!items.length) return;
  findings.push({ title, detail: `${items.length}件`, samples: items.slice(0, cap), level });
}

// 整形後タイトルに残る実況コメント/告知の兆候（商品名にはまず現れない語）。
const NOISE = [
  /高騰/, /ヤフオク/, /メルカリ/, /転売/, /せどり/, /まだあり|まだいけ/, /完売/, /再開|再販/,
  /お(?:早|はや)め/, /ご注意/, /人気(?:です|かと|順|高|沸騰|爆発)/, /です[！!]|ます[！!]/, /かと$/, /そうです/,
  /より.{0,12}(?:コラボ|開催|発売|登場|配信|上映|スタート|開始|実施|オープン|解禁|決定)[！!]/,
  /^【ニュース】|^【速報】/, /値引|[％%]オフ/, /品薄|即完/,
];

async function main() {
  const rows = await fetchRows();
  const deduped = dedupeItems(rows);
  const today = todayJst();
  const curYear = today.getUTCFullYear();
  console.log(`== ハツコレ データ監査 ==`);
  console.log(`表示スコープ ${rows.length}件 / dedupe後(掲載) ${deduped.length}件 / 基準日 ${today.toISOString().slice(0, 10)}\n`);

  // (1) 整形後タイトルの残ノイズ
  {
    const bad: string[] = [];
    for (const r of rows) {
      const c = cleanListTitle(r.source, r.title);
      const hit = NOISE.find((re) => re.test(c));
      if (hit) bad.push(`[${r.source} #${r.id}] «${hit.source}» ${c}`);
    }
    report("タイトル残ノイズ（実況/告知の混入疑い）", "warn", bad);
  }

  // (2) クロスソース/語順の近似重複が dedupe 後に残っていないか
  {
    const loose = (t: string) => [...dedupeKey(t)].sort().join("");
    const g = new Map<string, Row[]>();
    for (const it of deduped) {
      const k = loose(it.title);
      if (k.length < 8) continue;
      (g.get(k) ?? g.set(k, []).get(k)!).push(it);
    }
    const bad: string[] = [];
    for (const arr of g.values()) {
      if (arr.length < 2) continue;
      if (new Set(arr.map((x) => x.source)).size < 2) continue;
      if (new Set(arr.map((x) => dedupeKey(x.title))).size < 2) continue;
      bad.push(arr.map((x) => `${x.source}#${x.id}:${x.title}`).join("  ||  "));
    }
    report("クロスソース近似重複（dedupe漏れ）", "error", bad);
  }

  // (3) 同一ソースの二重掲載（整形後タイトル＋発売日一致）
  {
    const g = new Map<string, Row[]>();
    for (const it of deduped) {
      const key = dedupeKey(cleanListTitle(it.source, it.title));
      if (key.length < 8) continue;
      const day = it.eventDate ? new Date(it.eventDate).toISOString().slice(0, 10) : "none";
      (g.get(`${it.source}|${key}|${day}`) ?? g.set(`${it.source}|${key}|${day}`, []).get(`${it.source}|${key}|${day}`)!).push(it);
    }
    const bad: string[] = [];
    for (const arr of g.values()) if (arr.length >= 2) bad.push(arr.map((x) => `#${x.id}:${cleanListTitle(x.source, x.title)}`).join("  ||  "));
    report("同一ソース二重掲載（整形後タイトル＋日付一致）", "error", bad);
  }

  // (4) 抽選ラベルの整合性
  {
    const badPrize: string[] = []; // 旧「抽選賞品」ラベルの残存（未確認の断定）
    const badFlag: string[] = []; // hasLottery と highlights の仕組み表記の食い違い
    // highlights が「抽選・くじあり…」形式で仕組みを表すソースだけ、表記との整合を見る。
    // nyuka_now/tenbaiquest は highlights がストア形式表記なので対象外（抽選判定は販売形式で担保）。
    const HL_MECH = new Set(["collabo_cafe"]);
    for (const r of deduped) {
      const h = r.highlights ?? "";
      if (/賞品[:：]/.test(h) && !h.includes("各賞ラインナップ")) badPrize.push(`[${r.source} #${r.id}] ${h}`);
      if (HL_MECH.has(r.source)) {
        if (r.hasLottery && h && !/抽選|くじ|各賞ラインナップ/.test(h)) badFlag.push(`[${r.source} #${r.id}] hasLottery=true だが highlights に抽選表記なし: ${h}`);
        if (!r.hasLottery && /抽選・くじあり|抽選賞品/.test(h)) badFlag.push(`[${r.source} #${r.id}] hasLottery=false だが抽選表記: ${h}`);
      }
    }
    report("抽選: 未確認の『賞品』断定ラベル", "error", badPrize);
    report("抽選: hasLottery と highlights の不整合", "error", badFlag);
  }

  // (5) 価格の健全性
  {
    const bad: string[] = [];
    for (const r of deduped) {
      if (!r.price) continue;
      const y = parseYen(r.price.split(" / ")[0]);
      const t = cleanListTitle(r.source, r.title);
      const isBoxWord = /BOX|ＢＯＸ|box|箱|入り|カートン|セット/.test(r.title);
      const isSinglePack = /(?:ブースター|スターター)?パック/.test(t) && !isBoxWord;
      if (y != null && isSinglePack && y >= 3000) bad.push(`[${r.source} #${r.id}] ${y.toLocaleString()}円(BOX表記なしの単パック?) ${t}`);
      if (y != null && (y <= 0 || y > 3_000_000)) bad.push(`[${r.source} #${r.id}] 異常価格 ${r.price} ${t}`);
    }
    report("価格の疑い（単パックがBOX価格 / 異常値）", "warn", bad);
  }

  // (6) 同名商品が別ジャンルに分類（表記ゆれではなく分類ブレ）
  {
    const g = new Map<string, Set<string>>();
    const ex = new Map<string, string[]>();
    for (const it of deduped) {
      const key = dedupeKey(cleanListTitle(it.source, it.title));
      if (key.length < 10) continue;
      (g.get(key) ?? g.set(key, new Set()).get(key)!).add(it.genre);
      (ex.get(key) ?? ex.set(key, []).get(key)!).push(`${it.genre}#${it.id}`);
    }
    const bad: string[] = [];
    for (const [k, genres] of g) if (genres.size >= 2) bad.push(`${[...genres].join("/")}: ${ex.get(k)!.join(" ")}`);
    report("同名商品のジャンル分類ブレ", "warn", bad);
  }

  // (7) 日付の健全性（表示スコープに過去/遠すぎる未来が無いか）
  {
    const bad: string[] = [];
    for (const r of deduped) {
      if (!r.eventDate) continue;
      const d = new Date(r.eventDate);
      const y = d.getUTCFullYear();
      if (d < today) bad.push(`[${r.source} #${r.id}] 過去日 ${d.toISOString().slice(0, 10)} ${cleanListTitle(r.source, r.title)}`);
      if (y > curYear + 2) bad.push(`[${r.source} #${r.id}] 遠未来 ${d.toISOString().slice(0, 10)} ${cleanListTitle(r.source, r.title)}`);
    }
    report("日付の健全性（過去/遠未来の混入）", "error", bad);
  }

  // (8) タイトル末尾の宙ぶらりん助詞（文が途中で切れた痕跡）
  {
    const bad: string[] = [];
    for (const r of deduped) {
      const c = cleanListTitle(r.source, r.title);
      if (/[ぁ-ん一-龥][でにをはがのへ]$/.test(c) && /\s/.test(c)) bad.push(`[${r.source} #${r.id}] ${c}`);
    }
    report("タイトル末尾が宙ぶらりん助詞（文の途中で切れた痕跡）", "warn", bad, 12);
  }

  // ── 出力 ──
  const errors = findings.filter((f) => f.level === "error");
  const warns = findings.filter((f) => f.level === "warn");
  for (const f of [...errors, ...warns]) {
    console.log(`\n【${f.level === "error" ? "❌ERROR" : "⚠️WARN"}】${f.title}: ${f.detail}`);
    for (const s of f.samples) console.log(`   - ${s}`);
    if (f.samples.length < Number(f.detail.replace("件", ""))) console.log(`   … 他`);
  }
  console.log(`\n==== 監査結果: ERROR ${errors.length}種 / WARN ${warns.length}種 ====`);
  await prisma.$disconnect();
  if (errors.length) process.exitCode = 1;
}

main();
