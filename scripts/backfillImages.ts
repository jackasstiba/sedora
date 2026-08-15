/**
 * 画像なしのアイテムに、掲載中のリンク先（＝公式ページ・商品ページ・記事）から画像を後付けする。
 * `npm run scrape:images`（run_scrape.bat が毎回呼ぶ）。
 *
 * 【2026-08-15 全ソース化】以前はここが `SOURCES = ["channeltono","rarecheck"]` の決め打ちで、
 * **それ以外のソースは imageUrl=null のまま誰も触らない**状態だった。一覧完結型のスクレイパーは
 * 記事本文を開かないので画像を持てず（scrapers 側は imageUrl:null を返す設計）、後付けの対象外に
 * なった瞬間、そのソースは永久に画像ゼロになる。実測（修正前）:
 *   表示1302件中103件が画像なし。うち nyuka_now 39件・tenbaiquest 26件・kujimap 16件は
 *   **ソース丸ごと100%が画像なし**＝一覧が灰色タイルで埋まっていた。
 * → 対象は「表示中で imageUrl が空の全件」。新しいスクレイパーを足しても自動で面倒を見る。
 *   （取りこぼしは `npm run audit` の image_coverage / image_source_zero が毎回鳴らす）
 *
 * 取り方（上から順に試す。詳細は src/scrapers/imagePick.ts）:
 *   A. リンク先ページの og:image / twitter:image / JSON-LD Product / Amazon主画像 / 本文投稿画像
 *   B. ページ内で一意に決まる JAN(13桁) → 楽天検索 → **JANがURLに入っている**結果の画像
 *      （JANは商品の一意識別子なので、名前の当てずっぽうにならない。実測: 存在しないJANで
 *        検索すると楽天は無関係な商品を249件返すため、「JANがURLに含まれること」を必須にする）
 *   C. リンク先が検索結果ページのとき（tenbaiquest の楽天検索リンク）は、**商品名が全語一致**
 *      する結果の画像だけを借りる（1位を無条件に使うと別商品が出る。実測:
 *      「INSTINCTOY SHOW TOKYO 2026」の1位は菅田将暉のBlu-rayだった）
 *
 * 採らないもの: サイト共通のOGP/ロゴ/バナー。3つの網で落とす。
 *   ① URLのパターン（GENERIC_IMAGE_RE）
 *   ② **そのサイトのトップページの og:image と同じ**なら共通画像（ホスト別に1回だけ取得）
 *   ③ 複数のアイテムで共有される画像（SHARED_IMAGE_MAX 超）＝ブログの汎用バナー
 *
 * `--dry` で書き込まずに結果だけ出す（新しい取り方を入れたら必ず目視してから流す）。
 */
import { prisma } from "../src/lib/prisma";
import { sleep } from "../src/scrapers/util";
import { loadDisplayedItems } from "../src/lib/pages";
import { cleanListTitle } from "../src/lib/title";
import { hasSearchableTitle, rakutenSearchUrl } from "../src/lib/outbound";
import {
  absolutize,
  extractSoleJan,
  isGenericImageUrl,
  pickListedImage,
  pickMeta,
  pickPageImage,
  parseRakutenItemList,
  type ImageCandidate,
} from "../src/scrapers/imagePick";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
// 商品画像は商品ごとに違う。2件以上で同じ画像＝サイト共通バナー（実測: ちゃんねらー速報の
// 「予約開始！」という文字だけのGIFが3記事で共有され、以前の上限3では通り抜けていた）。
const SHARED_IMAGE_MAX = 1;
// 掃除（＝保存済み画像を外す）の方は緩くする。同じ画像2件は「同じイベントの重複掲載」で
// 起きるのが普通で（実測: collabo_cafe の同一コラボが2行）、それは重複解消の問題であって
// 画像の問題ではない。**消す側の判定は、間違えると情報を失う**ので3件以上に限る。
const CLEANUP_SHARED_MIN = 3;
// 商品写真がこれより小さいことはまず無い。文字バナー・アイコンを落とす最後の網（実測: 上記GIFが3KB）。
const MIN_IMAGE_BYTES = 4000;
const RATE_MS = 250;
const DRY = process.argv.includes("--dry");

/** 商品画像を置いていないと分かっているページ（応募フォーム・アプリ紹介）。取りに行かない。 */
const NO_IMAGE_HOST_RE = /docs\.google\.com|forms\.gle|apps\.apple\.com|play\.google\.com/i;

/** リンク先が「検索結果ページ」か（1位を商品画像として使えない）。 */
const SEARCH_PAGE_RE = /search\.rakuten\.co\.jp|shopping\.yahoo\.co\.jp\/search|amazon\.co\.jp\/s\?|suruga-ya\.jp\/search/i;

/**
 * 収集元の記事URL（JANを探すためだけに開く。**表示には一切使わない**）。
 * tenbaiquest は掲載URLを楽天検索に差し替えているので、記事は sourceId から組み直す。
 */
function sourceArticleUrl(source: string, sourceId: string): string | null {
  if (source === "tenbaiquest") return `https://tenbaiquest.com/${sourceId}`;
  if (source === "sofvi") return `https://sofvi.tokyo/${sourceId}/`; // 掲載URLは楽天検索なので記事はここから

  // channeltono / rarecheck は掲載URLがそのまま記事なので、ここで二重に取りに行かない。
  return null;
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "ja,en;q=0.8", Accept: "text/html,*/*" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// ── ② サイト共通画像の判定（トップページの og:image と同じなら商品画像ではない） ──
const rootImageCache = new Map<string, string | null>();
async function siteCommonImage(pageUrl: string): Promise<string | null> {
  let origin: string;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return null;
  }
  if (rootImageCache.has(origin)) return rootImageCache.get(origin)!;
  const html = await fetchText(origin + "/");
  const raw = html ? pickMeta(html, "og:image") ?? pickMeta(html, "twitter:image") : null;
  const abs = raw ? absolutize(raw, origin) : null;
  rootImageCache.set(origin, abs);
  await sleep(RATE_MS);
  return abs;
}

/** JAN で楽天を検索し、**JANがURLに含まれる**結果の画像だけを返す（＝同一商品と確認できたもの）。 */
async function imageByJan(jan: string): Promise<ImageCandidate | null> {
  const html = await fetchText(`https://search.rakuten.co.jp/search/mall/${jan}/`);
  await sleep(RATE_MS);
  if (!html) return null;
  for (const p of parseRakutenItemList(html)) {
    if (!p.image.includes(jan) && !p.url.includes(jan)) continue; // 別商品の“おすすめ”を弾く
    if (isGenericImageUrl(p.image)) continue;
    return { url: p.image, via: "jan" };
  }
  return null;
}

/**
 * 候補画像が本当に表示できるかを確かめる（https で 200・content-type が image・十分な大きさ）。
 * ここを通さないと、404やホットリンク禁止・文字バナーが「画像あり」として保存され、
 * 画面では NoImage タイルより悪い見た目になる。http は https サイトに埋めるとブロックされるので、
 * https に上げて試し、駄目なら諦める（実測: 麦わらストアの記事画像が http だった）。
 */
async function verifyImage(url: string): Promise<string | null> {
  const candidates = url.startsWith("http://") ? [url.replace(/^http:/, "https:")] : [url];
  for (const u of candidates) {
    try {
      const res = await fetch(u, { headers: { "User-Agent": UA, Referer: new URL(u).origin + "/" } });
      if (!res.ok) continue;
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.startsWith("image/")) continue;
      const bytes = (await res.arrayBuffer()).byteLength;
      if (bytes < MIN_IMAGE_BYTES) continue;
      return u;
    } catch {
      /* 次の候補へ */
    } finally {
      await sleep(RATE_MS);
    }
  }
  return null;
}

/**
 * 既に保存されている「商品画像ではない画像」を外して、取り直しの対象に戻す。
 * ①汎用画像パターンに当たるもの ②2件以上で同じ画像を使っているもの。
 * **imageUrl が埋まっている限り、この後のバックフィルは永久にその行を見ない**ので、
 * 掃除を先にやらないと直らない（実測 2026-08-15: no-image 画像48件＋共有バナー2件）。
 */
async function cleanupBadImages(): Promise<number> {
  const rows = (await loadDisplayedItems()).filter((r) => r.imageUrl);
  const freq = new Map<string, number>();
  for (const r of rows) freq.set(r.imageUrl!, (freq.get(r.imageUrl!) ?? 0) + 1);

  const bad = rows.filter((r) => isGenericImageUrl(r.imageUrl!) || freq.get(r.imageUrl!)! >= CLEANUP_SHARED_MIN);
  const why = new Map<string, number>();
  for (const r of bad) {
    const k = isGenericImageUrl(r.imageUrl!) ? "汎用画像" : `共有 x${freq.get(r.imageUrl!)}`;
    why.set(`${k}: ${r.imageUrl!.slice(0, 80)}`, (why.get(`${k}: ${r.imageUrl!.slice(0, 80)}`) ?? 0) + 1);
  }
  for (const [k, n] of [...why.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`  - ${n}件 ${k}`);
  if (!DRY && bad.length)
    await prisma.item.updateMany({ where: { id: { in: bad.map((r) => r.id) } }, data: { imageUrl: null } });
  return bad.length;
}

type Found = { id: number; source: string; title: string; cand: ImageCandidate };

async function main() {
  console.log("== 保存済み画像の掃除（商品画像でないものを外す）==");
  const cleaned = await cleanupBadImages();
  console.log(`${DRY ? "外す予定" : "外した"}: ${cleaned}件\n`);

  const rows = (await loadDisplayedItems()).filter((r) => !r.imageUrl);
  console.log(`画像なし（表示中）: ${rows.length}件${DRY && cleaned ? "（掃除分は --dry のため未反映）" : ""}`);

  const found: Found[] = [];
  const freq = new Map<string, number>();
  const viaCount: Record<string, number> = {};
  const missBySource: Record<string, number> = {};
  let done = 0;

  for (const r of rows) {
    let cand: ImageCandidate | null = null;
    const isSearch = SEARCH_PAGE_RE.test(r.url);

    if (!NO_IMAGE_HOST_RE.test(r.url)) {
      const html = await fetchText(r.url);
      await sleep(RATE_MS);
      if (html) {
        // A: リンク先が商品/記事ページなら、そのページの画像
        if (!isSearch) cand = pickPageImage(html, r.url);
        // C: リンク先が検索結果ページなら、商品名が全語一致する結果の画像だけ借りる
        if (!cand && isSearch) cand = pickListedImage(html, cleanListTitle(r.source, r.title));
        // B: 画像が無い記事でも JAN が一意に取れれば、その商品の画像を楽天から引ける
        if (!cand) {
          const jan = extractSoleJan(html);
          if (jan) cand = await imageByJan(jan);
        }
      }
    }

    // B': 掲載URLが記事でないソース（tenbaiquest）は、収集元の記事を開いて JAN を探す。
    //     記事そのものは表示しないので、収集元の非公開方針には触れない。
    if (!cand) {
      const article = sourceArticleUrl(r.source, r.sourceId);
      if (article) {
        const html = await fetchText(article);
        await sleep(RATE_MS);
        const jan = html ? extractSoleJan(html) : null;
        if (jan) cand = await imageByJan(jan);
      }
    }

    // D: リンク先が商品画像を持たない記事のとき（実測: トレカ速報は自前の og:image が
    //    "no-image" 画像で、本文にも商品写真が無い）、商品名で市場を検索して**全語一致した
    //    商品**の画像だけ借りる。タイトルが商品名として通用するソースに限る＝この判定は
    //    購入導線と同じ hasSearchableTitle を使う（Xミラー・コラボ記事の文章タイトルは対象外）。
    if (!cand && !isSearch && hasSearchableTitle(r.source)) {
      const name = cleanListTitle(r.source, r.title);
      const html = await fetchText(rakutenSearchUrl(name));
      await sleep(RATE_MS);
      if (html) cand = pickListedImage(html, name);
    }

    // ②サイト共通画像（トップと同じog:image）は不採用
    if (cand && cand.via !== "jan" && cand.via !== "listed") {
      const common = await siteCommonImage(r.url);
      if (common && common === cand.url) cand = null;
    }

    if (cand) {
      found.push({ id: r.id, source: r.source, title: r.title, cand });
      freq.set(cand.url, (freq.get(cand.url) ?? 0) + 1);
      viaCount[cand.via] = (viaCount[cand.via] ?? 0) + 1;
    } else {
      missBySource[r.source] = (missBySource[r.source] ?? 0) + 1;
    }

    done++;
    if (done % 20 === 0) console.log(`  ...${done}/${rows.length}（取得 ${found.length}件）`);
  }

  // ③ 共有されすぎる画像＝サイト共通バナー
  const rejected = new Set([...freq.entries()].filter(([, c]) => c > SHARED_IMAGE_MAX).map(([u]) => u));

  let updated = 0;
  let dead = 0;
  for (const f of found) {
    if (rejected.has(f.cand.url)) continue;
    const url = await verifyImage(f.cand.url);
    if (!url) {
      dead++;
      console.log(`  ✖ [${f.source} #${f.id}] 表示できない画像なので不採用: ${f.cand.url.slice(0, 90)}`);
      continue;
    }
    if (!DRY) await prisma.item.update({ where: { id: f.id }, data: { imageUrl: url } });
    updated++;
    console.log(`  ✔ [${f.source} #${f.id}] (${f.cand.via}) ${f.title.slice(0, 38)}\n      ${url}`);
  }

  console.log(
    `\n候補 ${found.length}件 / 共有画像として除外 ${rejected.size}種 / 表示できず不採用 ${dead}件 / ${DRY ? "付与予定" : "画像を付与"} ${updated}件`
  );
  console.log("取り方の内訳: " + (Object.entries(viaCount).map(([k, v]) => `${k}=${v}`).join(" ") || "なし"));
  const miss = Object.entries(missBySource).sort((a, b) => b[1] - a[1]);
  if (miss.length) console.log("取れなかった: " + miss.map(([k, v]) => `${k}=${v}`).join(" "));
  if (rejected.size) for (const u of rejected) console.log(`  x${freq.get(u)} 共有画像として不採用: ${u}`);
  if (DRY) console.log("\n(--dry のため書き込みはしていません)");
  await prisma.$disconnect();
}

main();
