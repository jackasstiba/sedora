/**
 * 「一覧のページ送りを自前で書く」のを禁じる静的検査（純関数）。
 *
 * なぜコードを検査するのか（2026-08-18・同じ日に2件出たので数えた）:
 * 固定ページ数の窓は**追い越されても件数もエラーも出ない**。実測で
 *   ・nyuka_now  … 上限8ページ ← 収集元17ページ ＝ 90記事(53%)を一度も見ていなかった
 *   ・channeltono … 上限3ページ＝45記事 ← 投稿は25記事/日 ＝ **1.8日分**の窓
 *                   （収集元の直近14日 355件のうち40件が未取込）
 *   ・pokemon_goods … 上限4ページ ← 窓のちょうど縁（1割増えたら落ちていた）
 * データを眺めても画面を見ても分からないが、**ファイルを読めば分かる型**なので機械で見る。
 *
 * 規約: ページ送りは `src/scrapers/crawl.ts` の `crawlPages` だけが書く。各スクレイパーは
 * 「終端の見分け方（新規0／足切りの日付）」と「安全弁の数」を**渡す**側に回る。
 * これは書き方の好みではなく、**上限に当たったら例外にする**という一点を全ソースで
 * 揃えるため（黙って半分だけ取り込むより、そのソースを赤くして前回値を保つ方が安全）。
 *
 * 検査対象は「ページ番号らしき変数のループの中で fetch している」形だけ。
 * 詳細ページを1件ずつ取りに行くループ（配列を回す）は対象外＝ページ送りではない。
 */
import { maskNonCode } from "./clockLint";

export type CrawlViolation = { file: string; line: number; rule: string; snippet: string };

/** 検査対象から外すファイルと、その理由。**理由を書かずに足さないこと。** */
export const CRAWL_ALLOWLIST: { file: string; reason: string }[] = [
  { file: "src/scrapers/crawl.ts", reason: "ページ送りの実装本体（この規約そのもの）" },
];

/** ページ番号として扱う変数名。`p` 単独も含む（実際に使われていた）。 */
const PAGE_VAR = /\b(page|paged|pageNo|pageNum|pageIndex|p)\b/;
/** ループの中で外部を叩いている＝一覧の取得。 */
const FETCH_CALL = /\b(fetchHtml|fetchHtmlDetectCharset|fetchJson|fetch)\s*\(/;

/** `(` の位置から対応する `)` の中身を返す。 */
function parenBody(src: string, open: number): { text: string; end: number } {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return { text: src.slice(open + 1, i), end: i };
    }
  }
  return { text: src.slice(open + 1), end: src.length };
}

/** `{` の位置から対応する `}` までを返す（ブロックが無ければ次の `;` まで）。 */
function blockAfter(src: string, from: number): string {
  let i = from;
  while (i < src.length && /\s/.test(src[i])) i++;
  if (src[i] !== "{") {
    const semi = src.indexOf(";", i);
    return src.slice(i, semi < 0 ? src.length : semi);
  }
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") {
      depth--;
      if (depth === 0) return src.slice(i, j + 1);
    }
  }
  return src.slice(i);
}

/** 1ファイル分の違反を返す（純関数）。file は表示用のパス。 */
export function findCrawlViolations(file: string, src: string): CrawlViolation[] {
  const code = maskNonCode(src);
  const out: CrawlViolation[] = [];
  for (const m of code.matchAll(/\b(for|while)\s*\(/g)) {
    const open = m.index! + m[0].length - 1;
    const { text: header, end } = parenBody(code, open);
    if (!PAGE_VAR.test(header)) continue;
    if (!FETCH_CALL.test(blockAfter(code, end + 1))) continue;
    out.push({
      file,
      line: code.slice(0, m.index!).split("\n").length,
      rule: "manual_page_loop",
      snippet: src
        .slice(m.index!, m.index! + 80)
        .replace(/\s+/g, " ")
        .trim(),
    });
  }
  return out;
}

export const CRAWL_RULE_WHY: Record<string, string> = {
  manual_page_loop:
    "ページ送りを自前で書いている。src/scrapers/crawl.ts の crawlPages を使う（終端で止まり、上限に当たったら例外にする＝取りこぼしを成功扱いにしない）",
};

/** 検査対象のファイルか（スクレイパーだけ・allowlist を除く）。 */
export function isCrawlLinted(file: string): boolean {
  const f = file.replace(/\\/g, "/");
  if (!f.startsWith("src/scrapers/")) return false;
  return !CRAWL_ALLOWLIST.some((a) => a.file === f);
}
