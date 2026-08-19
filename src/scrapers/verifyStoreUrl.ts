import { ScrapedItem } from "./types";
import { fetchHtmlDetectCharset, sleep } from "./util";
import { canJudgeIdentity, identityMatchCount, identityTokens } from "../lib/identity";
import { normalizeForSearch } from "../lib/itemFilter";

// ── 画面に出すURLの裏取り（2026-08-19）────────────────────────────────
//
// 実測で見つかった型: #92479「ポケモンカードゲーム MEGA 30th CELEBRATION プレミアムデッキセット」の
// item.url が **ヤマダデジタル会員アプリの説明ページ**（本文476字・商品名は一切無い）だった。
// preferredStoreUrl は「店舗ドメイン＞Googleフォーム＞X告知」の順に選ぶので、
// **店舗ドメインでありさえすれば、その商品が載っていない汎用ページでも1位になる**。
// サイトは item.url を「公式ページで見る」＝ここで応募できる、として出しているので、
// これは裏の取れない約束になる（[[UIラベルは裏取り済みのみ約束]]）。
//
// 直し方は「消えたから消す」ではなく「**確かめてから選ぶ**」。候補を順に開いて、
// 商品が載っているページを選ぶ。開けないもの（X告知・フォーム）は「分からない」に置き、
// **載っていないと分かったもの**より優先する（分からないことを、外れの根拠にしない）。

export type UrlVerdict = "ok" | "mismatch" | "unknown";

/**
 * 検証結果から画面に出すURLを選ぶ（純関数・selftest対象）。
 * 載っていると確かめた > 確かめられない > 載っていないと分かった、の順。
 */
export function chooseVerifiedUrl(
  candidates: { url: string; verdict: UrlVerdict; score?: number }[]
): string | null {
  // 「載っている」の中では**識別語が多く当たった方**を採る。2値で選ぶと、
  // 商品名の一般的な部分だけが当たった弱いページが1位になる（実測: ポケカの弾違いの告知）。
  const ok = candidates
    .filter((c) => c.verdict === "ok")
    .map((c, i) => ({ c, i, s: c.score ?? 1 }))
    .sort((a, b) => b.s - a.s || a.i - b.i);
  return (
    ok[0]?.c.url ??
    candidates.find((c) => c.verdict === "unknown")?.url ??
    candidates[0]?.url ??
    null
  );
}

/**
 * ホスト名を取り出す（壊れたURLは空文字）。**文字列の部分一致でホストを判定しない**
 * ＝ `(^|\.)x\.com` のような書き方は `https://x.com/…` の直前が `/` なので当たらない
 * （selftest で実際に外れた）。preferredStoreUrl と同じく URL で解く。
 */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isXUrl(url: string): boolean {
  return /(^|\.)(x\.com|twitter\.com)$/.test(hostOf(url));
}

function isFormUrl(url: string): boolean {
  const h = hostOf(url);
  return h === "docs.google.com" || h === "forms.gle";
}

/** 開いても中身が分からないURL（JSで描くフォーム・ログイン必須のX）。取りに行かない。 */
export function isUnreadableUrl(url: string): boolean {
  return isXUrl(url) || isFormUrl(url);
}

/** 候補URLを preferredStoreUrl と同じ優先順で並べる（店舗ドメイン＞フォーム＞X告知）。 */
export function orderedStoreUrls(stores: { url: string | null }[]): string[] {
  const urls = stores.map((s) => s.url).filter((u): u is string => !!u);
  const rank = (u: string) => (isXUrl(u) ? 2 : isFormUrl(u) ? 1 : 0);
  return urls
    .map((u, i) => ({ u, i, r: rank(u) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.u)
    .filter((u, i, a) => a.indexOf(u) === i);
}

/** 1候補あたりの上限。全店を開くと1商品で十数リクエストになるので、上位だけ確かめる。 */
const MAX_URL_CHECKS = 4;

/**
 * item.url を「その商品が載っていると確かめたページ」に差し替える。
 * 巡回のたびに走るので上位 MAX_URL_CHECKS 件までしか開かない（40商品 × 最大4件）。
 */
export async function verifyStoreUrls(
  source: string,
  items: ScrapedItem[],
  readPage: (url: string) => Promise<string | null>
): Promise<{ swapped: number; checked: number }> {
  let swapped = 0;
  let checked = 0;
  for (const it of items) {
    if (!it.stores) continue;
    const stores = JSON.parse(it.stores) as { url: string | null }[];
    const ordered = orderedStoreUrls(stores);
    if (ordered.length === 0) continue;
    // 識別語が1語しか無い商品名は、一致しなくても「載っていない」と言い切れない。
    if (!canJudgeIdentity(it.title)) continue;

    const verdicts: { url: string; verdict: UrlVerdict; score: number }[] = [];
    const need = identityTokens(it.title).length;
    for (const url of ordered.slice(0, MAX_URL_CHECKS)) {
      if (isUnreadableUrl(url)) {
        verdicts.push({ url, verdict: "unknown", score: 0 });
        continue;
      }
      checked++;
      const text = await readPage(url);
      if (text === null) {
        verdicts.push({ url, verdict: "unknown", score: 0 });
        continue;
      }
      const score = identityMatchCount(text, it.title);
      verdicts.push({ url, verdict: score > 0 ? "ok" : "mismatch", score });
      // 識別語が全部当たった＝これ以上良い候補は無いので、余計に叩かない。
      if (score >= need) break;
      await sleep(300);
    }
    const picked = chooseVerifiedUrl(verdicts) ?? it.url;
    if (picked !== it.url) {
      console.log(`[${source}] URLを差し替え: ${it.title.slice(0, 28)} → ${picked}`);
      it.url = picked;
      swapped++;
    }
  }
  return { swapped, checked };
}


/** 候補ページを読んで、突合用に正規化した本文を返す（読めなければ null＝「分からない」）。 */
export async function readPageText(url: string): Promise<string | null> {
  try {
    const html = await fetchHtmlDetectCharset(url);
    // 商品名は <title> にしか無いページがある（実測: 一次ストアの商品ページ）。本文と一緒に見る。
    const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
    const og = html.match(/property="og:title"[^>]*content="([^"]*)"/)?.[1] ?? "";
    const body = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ");
    return normalizeForSearch(`${title} ${og} ${body}`.replace(/\s+/g, " ").trim());
  } catch {
    return null;
  }
}

