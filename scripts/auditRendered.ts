/**
 * 描画結果の監査（`npm run audit:page`）。
 *
 * これまでの `npm run audit` は **DBの値** を検査していた。だが今日見つかった粗の一部は
 * 「データは正しいが、画面に出た形が読めない/食い違う」層だった:
 *   ・受付中ストアが「お宝創庫（8/6 12:00〜）、お宝創庫（8/6 12:00〜）」と同じ文字列で並ぶ
 *   ・日付欄に「投稿日: 8/7」が発売日と同じ赤字で出る
 * データの不変条件をいくら足しても、この層は原理的に見えない。**実際に配信されるHTMLを
 * 取ってきて、そこに出ている文字列だけを見る** のがこのスクリプトの役割。
 *
 * 使い方:
 *   npm run audit:page                       … 既定のベースURL（ローカル: http://localhost:3000）
 *   npm run audit:page -- --base https://…   … デプロイ済みの本番を検査する
 *
 * ページの一覧と「そのページが出すはずの件数」は src/lib/pages.ts（表示範囲の唯一の定義）
 * から取る。つまり **サーバーが返すべき件数と、実際に描画された枚数** を突き合わせられる。
 */
import * as cheerio from "cheerio";
import { prisma } from "../src/lib/prisma";
import { loadDisplayedPages } from "../src/lib/pages";

const args = process.argv.slice(2);
const baseIdx = args.indexOf("--base");
const BASE = (baseIdx >= 0 ? args[baseIdx + 1] : "http://localhost:3000").replace(/\/$/, "");

type Finding = { page: string; kind: string; detail: string };
const findings: Finding[] = [];
function flag(page: string, kind: string, detail: string) {
  findings.push({ page, kind, detail });
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SedoriRadar-audit/1.0)" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** ページのURL（表示名 → 実URL）。ジャンル名などは URL エンコードする。 */
function toUrl(name: string): string {
  const parts = name.split("/").filter(Boolean).map((s) => encodeURIComponent(s));
  return `${BASE}/${parts.join("/")}`;
}

/** 商品カードの見出しテキストを取り出す（カードは /items/N へのリンク）。 */
function cardTitles($: cheerio.CheerioAPI): string[] {
  const out: string[] = [];
  $('a[href^="/items/"]').each((_, el) => {
    const t = $(el).find("h3").first().text().trim() || $(el).text().trim();
    if (t) out.push(t.replace(/\s+/g, " "));
  });
  return out;
}

async function main() {
  console.log(`== ハツコレ 描画監査 == (${BASE})`);
  const pages = await loadDisplayedPages();

  let checked = 0;
  let cardsSeen = 0;
  let listItemsSeen = 0;
  for (const p of pages) {
    const html = await fetchPage(toUrl(p.name));
    if (html === null) {
      flag(p.name, "取得失敗", `ページを取得できない（${toUrl(p.name)}）`);
      continue;
    }
    checked++;
    const $ = cheerio.load(html);
    // <script>/<style> はテキスト検査から外す（JSONペイロードに undefined 等が出るため）。
    $("script, style, noscript").remove();
    const text = $("main").text().replace(/\s+/g, " ").trim() || $("body").text();
    const titles = cardTitles($);
    cardsSeen += titles.length;
    listItemsSeen += $("ul > li, ol > li").length;

    // (1) 未定義値の露出。人間なら一瞬で気付くが、機械でしか網羅できない。
    for (const bad of ["undefined", "NaN", "[object Object]", "Invalid Date", "null件"]) {
      if (text.includes(bad)) flag(p.name, "未定義値の露出", `本文に「${bad}」が出ている`);
    }

    // (2) 生のHTMLエンティティ・タグ片が本文に出ていないか（整形漏れ）。
    for (const bad of ["&amp;", "&nbsp;", "&quot;", "<br", "</p>"]) {
      if (text.includes(bad)) flag(p.name, "エスケープ漏れ", `本文に「${bad}」が出ている`);
    }
    // 数値エンティティ（&#8217; 等）。実測: kujimap の PINGU&#8217;S がカード名に生で出た
    // （固定文字列のリストでは新しい型を拾えない）。
    const numEnt = text.match(/&#x?[0-9a-fA-F]{2,6};/);
    if (numEnt) flag(p.name, "エスケープ漏れ", `本文に「${numEnt[0]}」が出ている`);

    // (3) 見出しの件数・「もっと見る（残りN件）」・実際の描画枚数の三者が噛み合っているか。
    //     一覧は120件ずつの段階表示なので「見出し＝描画枚数」ではない。ただし
    //     **見出しの件数 ＝ 描画枚数 ＋ 残り件数** は常に成り立たなければならない。
    //     ここが崩れるのは、本人が最も嫌う"数字の間違い"がそのまま出ている状態。
    const more = text.match(/もっと見る（残り\s*([\d,]+)\s*件）/);
    const remaining = more ? Number(more[1].replace(/,/g, "")) : 0;
    const counts = [...text.matchAll(/(掲載|相場|受付中・予定)\s*([\d,]+)\s*件/g)];
    for (const m of counts) {
      const stated = Number(m[2].replace(/,/g, ""));
      if (stated !== titles.length + remaining)
        flag(
          p.name,
          "件数の食い違い",
          `見出し「${m[1]} ${stated} 件」≠ 描画 ${titles.length} 枚 ＋ 残り ${remaining} 件`
        );
    }

    // (4) サーバーが返す件数と、画面が示す総数（描画＋残り）の食い違い。
    //     取得関数の件数と画面の件数がズレたら、どちらかが嘘をついている。
    if (titles.length + remaining !== p.rows.length)
      flag(
        p.name,
        "描画枚数の食い違い",
        `データは ${p.rows.length}件だが、画面は ${titles.length} 枚＋残り ${remaining} 件＝${titles.length + remaining}件`
      );

    // (5) 同じ見出しのカードが同じページに複数（画面上の重複）。
    const seen = new Map<string, number>();
    for (const t of titles) seen.set(t, (seen.get(t) ?? 0) + 1);
    for (const [t, n] of seen) if (n > 1) flag(p.name, "画面上の重複", `「${t}」が ${n} 枚`);

    // (6) 同じ文字列が隣り合って並ぶ（受付中ストアで実際に起きた型の一般化）。
    //     リスト項目・チップなど、繰り返し要素の隣接重複を見る。
    $("ul, ol").each((_, ul) => {
      const items = $(ul)
        .children("li")
        .map((_, li) => $(li).text().replace(/\s+/g, " ").trim())
        .get();
      for (let i = 1; i < items.length; i++) {
        if (items[i] && items[i] === items[i - 1])
          flag(p.name, "隣接する同一表示", `リスト内で「${items[i].slice(0, 50)}」が連続`);
      }
    });

    // (7) 空のページ（見出しはあるのにカードが0枚）。
    if (p.rows.length > 0 && titles.length === 0)
      flag(p.name, "空ページ", `データは ${p.rows.length}件あるのにカードが0枚`);
  }

  // 商品詳細ページも見る。受付中ストア一覧・各賞ギャラリーは詳細にしか無く、
  // 一覧ページだけ見ていると **リスト項目を1件も検査していない**（＝発火しようのない検査を
  // 持っているだけ）になる。実際に「同じストアが2行並ぶ」粗が起きたのはこの面だった。
  {
    const all = pages.flatMap((p) => p.rows);
    const byId = new Map(all.map((r) => [r.id, r]));
    // 受付中ストアを持つ商品は全件見る（リスト表示の粗が実際に出た面なので抜き取りにしない）。
    const withStores = [...byId.values()].filter((r) => r.stores);
    const withPrizes = [...byId.values()].filter((r) => !r.stores && r.prizes).slice(0, 15);
    const rich = [...withStores, ...withPrizes];
    const rest = [...byId.values()].filter((r) => !r.stores && !r.prizes);
    const sample = rest.filter((_, i) => i % Math.max(1, Math.floor(rest.length / 20)) === 0).slice(0, 20);
    for (const r of [...rich, ...sample]) {
      const html = await fetchPage(`${BASE}/items/${r.id}`);
      if (html === null) {
        flag(`/items/${r.id}`, "取得失敗", "詳細ページを取得できない");
        continue;
      }
      checked++;
      const $ = cheerio.load(html);
      $("script, style, noscript").remove();
      const text = $("main").text().replace(/\s+/g, " ").trim();
      for (const bad of ["undefined", "NaN", "[object Object]", "Invalid Date"]) {
        if (text.includes(bad)) flag(`/items/${r.id}`, "未定義値の露出", `本文に「${bad}」が出ている`);
      }
      for (const bad of ["&amp;", "&nbsp;", "&quot;", "<br", "</p>"]) {
        if (text.includes(bad)) flag(`/items/${r.id}`, "エスケープ漏れ", `本文に「${bad}」が出ている`);
      }
      const numEnt2 = text.match(/&#x?[0-9a-fA-F]{2,6};/);
      if (numEnt2) flag(`/items/${r.id}`, "エスケープ漏れ", `本文に「${numEnt2[0]}」が出ている`);
      $("ul, ol").each((_, ul) => {
        const items = $(ul)
          .children("li")
          .map((_, li) => $(li).text().replace(/\s+/g, " ").trim())
          .get();
        listItemsSeen += items.length;
        // 隣接だけでなく**同じリスト内のどこかで**同じ文字列が2回出たら指摘する。
        // 並び順に関係なく、読む側には区別がつかない＝それが粗。
        const seenText = new Map<string, number>();
        for (const t of items) if (t) seenText.set(t, (seenText.get(t) ?? 0) + 1);
        for (const [t, n] of seenText)
          if (n > 1) flag(`/items/${r.id}`, "区別できない同一表示", `リスト内で「${t.slice(0, 50)}」が ${n} 回`);
      });
    }
  }

  // 「指摘0件」が“ちゃんと見た上での0件”なのか“何も見ていない0件”なのかを区別するため、
  // 実際に検査した物量を必ず出す。セレクタが壊れると0枚になり、静かに素通りするのを防ぐ。
  console.log(`検査したページ ${checked}/${pages.length} / 商品カード ${cardsSeen}枚 / リスト項目 ${listItemsSeen}件`);
  if (checked > 0 && cardsSeen === 0) {
    flag("(全体)", "検査が空振り", "商品カードを1枚も検出できていない（セレクタが壊れた疑い）");
  }
  if (findings.length === 0) {
    console.log("\n==== 描画監査: 指摘 0件 ====");
    await prisma.$disconnect();
    return;
  }

  const byKind = new Map<string, Finding[]>();
  for (const f of findings) (byKind.get(f.kind) ?? byKind.set(f.kind, []).get(f.kind)!).push(f);
  for (const [kind, arr] of byKind) {
    console.log(`\n【❌】${kind}: ${arr.length}件`);
    for (const f of arr.slice(0, 8)) console.log(`   - ${f.page}: ${f.detail}`);
    if (arr.length > 8) console.log(`   … 他 ${arr.length - 8}件`);
  }
  console.log(`\n==== 描画監査: 指摘 ${findings.length}件 ====`);
  await prisma.$disconnect();
  process.exitCode = 1;
}

main();
