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
import { countdownBadgeProblem, parseDisplayedDate, renderedDateProblems, todayJst } from "../src/lib/date";
import { closedStoreRowProblem } from "../src/lib/renderedStores";
import { AD_DISCLOSURE, AD_DISCLOSURE_EN, isOfficialUrl, isRakutenAffiliateId } from "../src/lib/outbound";

const args = process.argv.slice(2);
const baseIdx = args.indexOf("--base");
const BASE = (baseIdx >= 0 ? args[baseIdx + 1] : "http://localhost:3000").replace(/\/$/, "");

/**
 * 期待する楽天アフィリリンクの先頭（＝手元の .env のID）。
 *
 * **本番のアフィリは、コードではなく Vercel の環境変数で決まる。** そこが消えても・typo でも
 * リンクは楽天に飛ぶので画面は完全に正常なまま、成果だけが静かに0になる（目視では絶対に
 * 見つからない型）。ここは実際に配信されたHTMLを見る唯一の検査なので、`--base` に本番を
 * 渡したときに **手元のIDと同じアフィリリンクが本当に出ているか** を突き合わせる。
 */
const EXPECTED_ID = (process.env.RAKUTEN_AFFILIATE_ID ?? "").trim();
const AFFILIATE_PREFIX = isRakutenAffiliateId(EXPECTED_ID)
  ? `https://hb.afl.rakuten.co.jp/hgc/${EXPECTED_ID}/`
  : null;

type Finding = { page: string; kind: string; detail: string };
const findings: Finding[] = [];
function flag(page: string, kind: string, detail: string) {
  findings.push({ page, kind, detail });
}

/**
 * 広告である旨の表示が、そのページに出ているか（ステマ規制／楽天のガイドライン）。
 * ヘッダー直下＝`<main>` の外に出しているので、**body 全体**の文字列で見る。
 */
function checkAdDisclosure($: cheerio.CheerioAPI, page: string): boolean {
  const body = $("body").text().replace(/\s+/g, " ");
  // 英語ページ（/en）は英語の開示文（AD_DISCLOSURE_EN）。どちらかが出ていればよい。
  if (body.includes(AD_DISCLOSURE) || body.includes(AD_DISCLOSURE_EN)) return true;
  flag(page, "広告表示の欠落", `「${AD_DISCLOSURE}」（または英語版）がページに出ていない`);
  return false;
}

/**
 * 楽天リンク（＝このサイト唯一の収益導線）が、期待するアフィリIDで出ているか。
 * 返すのは「見たアフィリリンクの本数」＝母数。0本のまま終わったら検査が空振りしている。
 */
function checkRakutenLinks($: cheerio.CheerioAPI, page: string): number {
  let seen = 0;
  $('a[href*="rakuten.co.jp"]').each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (href.startsWith("https://search.rakuten.co.jp/")) {
      // 素の検索URLがそのまま出ている＝アフィリを通っていない（成果が付かない）。
      flag(page, "アフィリを通っていない楽天リンク", `素の検索URLが出ている ${href.slice(0, 80)}`);
      return;
    }
    if (!href.startsWith("https://hb.afl.rakuten.co.jp/")) return; // 画像等（<a>以外の楽天ホスト）
    seen++;
    if (AFFILIATE_PREFIX && !href.startsWith(AFFILIATE_PREFIX))
      flag(page, "別のアフィリIDのリンク", `期待と違うIDで出ている ${href.slice(0, 80)}`);
  });
  return seen;
}

/**
 * **配信したHTMLから収集元が割れないか。**
 *
 * 「リンクを画面に出さない」だけでは非公開にならない。実測 2026-08-18: トップページの
 * HTMLに収集元の記事URLが埋まっていた（collabo-cafe.com 835回・ota-goods.info 441回・
 * figisland.net 348回・kore-tore.com 26回・snkrdunk.com 20回）。カードが表示に使わない
 * `url` / `imageUrl` まで、クライアント部品への受け渡しでそのまま配信されていたため。
 * 画面を見ても分からない層なので、**配信されたHTMLの文字列**を見るしかない。
 *
 * 隠すべきホストは手で書かない。**item.url を画面に出さないと決めているソース
 * （isOfficialUrl が false）の実データのホスト**を、そのまま隠すべき集合として使う。
 * 収集元が増えた日に自動で網が広がる。
 */
function hiddenSourceHosts(rows: { source: string; url: string }[]): string[] {
  const hosts = new Set<string>();
  for (const r of rows) {
    if (isOfficialUrl(r.source)) continue;
    // 内部名そのものも隠す対象。URLを消しても "tenbaiquest" "torecasoku" が配信物に
    // 残っていれば、収集元の名前を出しているのと同じ（実測 2026-08-18: figisland 516回・
    // collabo_cafe 393回・torecasoku 240回。カード用データを丸ごとブラウザへ渡していた）。
    hosts.add(r.source);
    try {
      const h = new URL(r.url).hostname.replace(/^www\./, "").toLowerCase();
      // 楽天検索は購入導線（隠している収集元ではない）。x.com は共有ボタンでも出るので別扱い。
      if (/(^|\.)rakuten\.co\.jp$/.test(h) || h === "x.com" || h === "twitter.com") continue;
      hosts.add(h);
    } catch {
      /* URLとして壊れている行は別の検査が拾う */
    }
  }
  return [...hosts];
}

/** そのページのHTMLに、隠すべきホスト名が何回出たか。0でなければ即アウト。 */
function checkSourceLeak(html: string, page: string, hosts: string[]): number {
  let hits = 0;
  for (const h of hosts) {
    const n = html.split(h).length - 1;
    if (n > 0) {
      hits += n;
      flag(page, "収集元がHTMLに出ている", `「${h}」が ${n}回（画面に出していなくても配信物に含まれている）`);
    }
  }
  return hits;
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

/**
 * **同じカードの中**で、カウントダウンのバッジと日付ラベルが食い違っていないか。
 *
 * テキストの隣接では判定できない（実測: 描画は「🔥 本日ワンピースカード8/16(日)」と
 * 別要素が隙間なく繋がるので、作品名「明日ちゃんのセーラー服」と区別がつかない）。
 * カード要素（/items/N へのリンク）を単位にして、その中の span 同士を突き合わせる。
 */
function cardDateProblems($: cheerio.CheerioAPI, today: Date): { problems: string[]; badges: number } {
  const problems: string[] = [];
  let badges = 0;
  $('a[href^="/items/"]').each((_, el) => {
    const card = $(el);
    const texts = card
      .find("span")
      .map((_, s) => $(s).text().replace(/\s+/g, " ").trim())
      .get();
    const badge = texts.find((t) =>
      /^(?:🔥\s*)?(?:本日|明日|あと\d{1,2}日|Today|Tomorrow|In \d{1,2} days?)$/.test(t)
    );
    if (!badge) return;
    badges++;
    const dateLabel = texts.find(
      (t) =>
        /^(?:\d{4}[年/])?\d{1,2}[/月]\d{1,2}日?(?:\([日月火水木金土]\))?$/.test(t) ||
        // 英語版のラベル（date.formatShortEn の書式と対）
        /^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}(?:, \d{4})? \((?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\)$/.test(t)
    );
    if (!dateLabel) {
      problems.push(`カウントダウン「${badge}」が出ているのに日付ラベルが無い（${card.attr("href")}）`);
      return;
    }
    const problem = countdownBadgeProblem(badge, dateLabel, today);
    if (problem) problems.push(`${problem}（${card.attr("href")}）`);
  });
  return { problems, badges };
}

/**
 * **見出しが「受付中」と約束している節に、締切が過ぎた店が並んでいないか。**
 *
 * 2026-08-18 実測（観点B）: `/items/75417` の「🎯 抽選・予約 受付中ストア（126店・応募ページ
 * 126件）／現在応募・予約を受付中のストアです」の中に、**締切が昨日で終わった店が30店**
 * 並んでいた。並びは締切の昇順なので**先頭30店がすべて死んでいる**＝上から順に応募ページを
 * 開くという普通の使い方が全部空振りする。
 *
 * これが既存の検査で1つも鳴らなかった理由: audit はDBの値を見る（締切の値自体は正しい）、
 * audit:facts は外部本文と突き合わせる（対象外）、audit:page の日付検査は「🔥本日バッジ↔
 * 日付ラベル」というカード内の突合で、**見出しの約束と、その下に並ぶ締切**は誰も見ていなかった。
 *
 * 判定は画面の文字列だけで行う。締切表記（"〜8/17 20:00"）だけを見て、受付開始表記
 * （"8/20 00:00〜"）は見ない。年は `parseDisplayedDate` の「基準日にいちばん近い年」規則で
 * 解釈する（年跨ぎで 1/5 を過去と誤判定しないため。audit:clock が年またぎを回す）。
 */
function closedStoresShownAsOpen(
  $: cheerio.CheerioAPI,
  today: Date
): { problems: string[]; examined: number } {
  const problems: string[] = [];
  let examined = 0;
  $("section").each((_, sec) => {
    if (!$(sec).find("h2").first().text().includes("受付中ストア")) return;
    $(sec)
      .find("li")
      .each((_, li) => {
        examined++;
        // 判定そのものは純関数（合成データで両側を固定できる形）。この粗は巡回直後だけ
        // 消えるので、**本番を測った0件は「直っている」証拠にならない**＝ src/lib/renderedStores.ts。
        const p = closedStoreRowProblem($(li).text(), today, parseDisplayedDate);
        if (p) problems.push(p);
      });
  });
  return { problems, examined };
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
  const today = todayJst();
  const pages = await loadDisplayedPages();

  let checked = 0;
  let cardsSeen = 0;
  let listItemsSeen = 0;
  // 「🔥本日/明日/あとN日」のバッジを何枚見たか。0枚なら日付の突合は空振り（＝何も守っていない）。
  let badgesSeen = 0;
  // 「受付中ストア」節の行を何行見たか。stores を持つ商品があるのに0行なら空振り。
  let storeRowsSeen = 0;
  let storeItemsCount = 0;
  // 楽天アフィリリンクを何本見たか。本番に出ていなければ収益は0なので、0本で終わったら
  // 「きれいだから0件」ではなく検査の空振り（＝収益導線が消えていても気付けない状態）。
  let rakutenLinksSeen = 0;
  // 隠すべき収集元ホスト（実データから導出）と、HTMLに出てしまった回数。
  const hiddenHosts = hiddenSourceHosts(pages.flatMap((p) => p.rows));
  let sourceLeaks = 0;
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
    sourceLeaks += checkSourceLeak(html, p.name, hiddenHosts);
    checkAdDisclosure($, p.name);
    rakutenLinksSeen += checkRakutenLinks($, p.name);
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
    const more =
      text.match(/もっと見る（残り\s*([\d,]+)\s*件）/) ??
      text.match(/Show more \(([\d,]+) remaining\)/); // 英語版（i18n.UI.en.showMore と対）
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
    // 英語版の見出し件数（/en の「Listed: N items」）。JPと同じ突合。
    for (const m of text.matchAll(/Listed:\s*([\d,]+)\s*items/g)) {
      const stated = Number(m[1].replace(/,/g, ""));
      if (stated !== titles.length + remaining)
        flag(
          p.name,
          "件数の食い違い",
          `見出し「Listed: ${stated} items」≠ 描画 ${titles.length} 枚 ＋ 残り ${remaining} 件`
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

    // (8) **画面に出ている日付そのものの整合**（曜日／本日・明日・あとN日）。
    //     人間が一目で気付く型（1画面の中で上下が食い違う）を、描画結果の文字列で見る。
    for (const msg of renderedDateProblems(text, today)) flag(p.name, "日付の食い違い（画面）", msg);
    const cardDates = cardDateProblems($, today);
    badgesSeen += cardDates.badges;
    for (const msg of cardDates.problems) flag(p.name, "日付の食い違い（画面）", msg);
  }

  // 商品詳細ページも見る。受付中ストア一覧・各賞ギャラリーは詳細にしか無く、
  // 一覧ページだけ見ていると **リスト項目を1件も検査していない**（＝発火しようのない検査を
  // 持っているだけ）になる。実際に「同じストアが2行並ぶ」粗が起きたのはこの面だった。
  {
    const all = pages.flatMap((p) => p.rows);
    const byId = new Map(all.map((r) => [r.id, r]));
    // 受付中ストアを持つ商品は全件見る（リスト表示の粗が実際に出た面なので抜き取りにしない）。
    const withStores = [...byId.values()].filter((r) => r.stores);
    storeItemsCount = withStores.length;
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
      sourceLeaks += checkSourceLeak(html, `/items/${r.id}`, hiddenHosts);
      checkAdDisclosure($, `/items/${r.id}`);
      rakutenLinksSeen += checkRakutenLinks($, `/items/${r.id}`);
      for (const bad of ["undefined", "NaN", "[object Object]", "Invalid Date"]) {
        if (text.includes(bad)) flag(`/items/${r.id}`, "未定義値の露出", `本文に「${bad}」が出ている`);
      }
      for (const bad of ["&amp;", "&nbsp;", "&quot;", "<br", "</p>"]) {
        if (text.includes(bad)) flag(`/items/${r.id}`, "エスケープ漏れ", `本文に「${bad}」が出ている`);
      }
      const numEnt2 = text.match(/&#x?[0-9a-fA-F]{2,6};/);
      if (numEnt2) flag(`/items/${r.id}`, "エスケープ漏れ", `本文に「${numEnt2[0]}」が出ている`);
      // 商品詳細は「上部の抽選日バッジ」と「下の店舗行の締切」が同じ画面に並ぶ面。
      // 2026-08-16 に実際に食い違っていたのはここ（上=🔥本日／下=〜明日 22:00）。
      for (const msg of renderedDateProblems(text, today))
        flag(`/items/${r.id}`, "日付の食い違い（画面）", msg);
      const itemCardDates = cardDateProblems($, today);
      badgesSeen += itemCardDates.badges;
      for (const msg of itemCardDates.problems) flag(`/items/${r.id}`, "日付の食い違い（画面）", msg);
      // 見出しの約束（「受付中」）と、その下に並ぶ締切の突合。
      const closed = closedStoresShownAsOpen($, today);
      storeRowsSeen += closed.examined;
      for (const msg of closed.problems) flag(`/items/${r.id}`, "受付終了の店を受付中として出している", msg);
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
  console.log(
    `検査したページ ${checked}/${pages.length} / 商品カード ${cardsSeen}枚 / リスト項目 ${listItemsSeen}件 / ` +
      `カウントダウンのバッジ ${badgesSeen}枚 / 受付中ストア行 ${storeRowsSeen}行（${storeItemsCount}商品） / 楽天アフィリリンク ${rakutenLinksSeen}本 / 隠すべき収集元 ${hiddenHosts.length}ホスト（HTMLに ${sourceLeaks}回）`
  );
  // 隠すべきホストが1つも作れていないなら、この検査は何も守っていない。
  if (checked > 0 && hiddenHosts.length === 0) {
    flag("(全体)", "検査が空振り", "隠すべき収集元ホストを1つも導出できていない（実データの url が読めていない）");
  }
  // 収益導線は詳細ページにしか無い。1本も見ていないなら、本番のアフィリが消えていても
  // この監査は「指摘0件」と言ってしまう（＝守っていない）。
  if (checked > 0 && rakutenLinksSeen === 0) {
    flag(
      "(全体)",
      "検査が空振り",
      AFFILIATE_PREFIX
        ? "楽天アフィリリンクを1本も検出できていない（収益導線が消えている疑い／セレクタ破損）"
        : "楽天アフィリリンクを1本も検出できていない（RAKUTEN_AFFILIATE_ID が手元に無いのでIDの照合もしていない）"
    );
  }
  // 「受付中ストア」の検査は母数が要る。stores を持つ商品があるのに1行も見ていないなら、
  // それは「きれいだから0件」ではなく「何も見ていない0件」（セレクタ・見出し文言の変更）。
  if (storeItemsCount > 0 && storeRowsSeen === 0) {
    flag("(全体)", "検査が空振り", "「受付中ストア」の行を1行も検出できていない（締切の突合が動いていない）");
  }
  if (checked > 0 && cardsSeen === 0) {
    flag("(全体)", "検査が空振り", "商品カードを1枚も検出できていない（セレクタが壊れた疑い）");
  }
  // 日付バッジの突合は「見た枚数」を出さないと 0件の意味が決まらない。
  // 実測: 最初の版はテキストの隣接で判定していて、本番の描画では**1枚も突き合わせていなかった**
  // （バッジと日付が別要素で、テキストにすると作品名と繋がるため）。
  if (checked > 0 && badgesSeen === 0) {
    flag("(全体)", "検査が空振り", "カウントダウンのバッジを1枚も検出できていない（日付の突合が動いていない）");
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
