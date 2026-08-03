import * as cheerio from "cheerio";
import { fetchHtml } from "./util";

// 駿河屋の検索結果から「中古/新品の販売価格」を相場の代理指標として取得する。
// 駿河屋はSSR（jQuery系）なので素のfetch+Cheerioで取れる（Playwright不要）。
// 結果0件のとき駿河屋はHTTP 404 + 「該当なし」ページを返すので、その場合は null。

export type MarketPrice = {
  price: number; // 円（数値）
  priceText: string; // 表示用（例: "中古 ¥3,980"）
  url: string; // 駿河屋商品ページ
  source: "surugaya";
  matchedName?: string; // 実際にヒットした駿河屋の商品名（呼び出し側の追加検証用）
};

const BASE = "https://www.suruga-ya.jp";

/** 検索語を作る。日付/編集タグを含む生タイトルは重いので、記号を整理して短めに。 */
function toQuery(title: string): string {
  return title
    .replace(/[【】\[\]「」（）()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 8)
    .join(" ");
}

/** マッチ判定用に文字列を正規化（全角→半角・記号除去・小文字化）。呼び出し側の追加検証でも使う。 */
export function norm(s: string): string {
  return s
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toLowerCase()
    .replace(/[\s　・,，.。!！?？:：/／()（）【】\[\]「」'"`~-]/g, "");
}

/** 誤マッチ防止：商品名とレアレーダー側タイトルの2-gram重なり率 */
function similarity(a: string, b: string): number {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return 0;
  const grams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const ga = grams(na);
  const gb = grams(nb);
  if (ga.size === 0 || gb.size === 0) return 0;
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  return inter / Math.min(ga.size, gb.size);
}

/** タイトルで駿河屋を検索し、最も近い商品の中古/新品価格を返す。無ければ null。 */
export async function fetchSurugayaPrice(title: string): Promise<MarketPrice | null> {
  const q = toQuery(title);
  if (q.length < 3) return null;
  const url = `${BASE}/search?category=&search_word=${encodeURIComponent(q)}`;

  let html: string;
  try {
    html = await fetchHtml(url); // 404（該当なし）は fetchHtml が throw する
  } catch {
    return null; // 該当商品なし＝相場なし（未発売品など）
  }

  const $ = cheerio.load(html);
  const items = $("div.item");
  type Cand = { score: number; price: number; priceText: string; href: string; name: string };
  const cands: Cand[] = [];

  items.each((_, el) => {
    const $it = $(el);
    const name = $it.find("h3.product-name").first().text().trim();
    const href = $it.find(".title a[href], a[href*='/product/detail/']").first().attr("href") || "";
    if (!name || !href) return;

    // 中古/新品の販売価格を持つ price_teika を拾う（"定価" 行は除外）
    let price = 0;
    let priceText = "";
    $it.find("p.price_teika").each((__, p) => {
      const txt = $(p).text().replace(/\s+/g, " ").trim();
      if (/定価/.test(txt)) return;
      const m = txt.match(/(中古|新品|買取)?\s*[：:]?\s*[¥￥]?\s*([0-9,]+)\s*円?/);
      if (m && !price) {
        price = Number(m[2].replace(/,/g, ""));
        const label = m[1] || "中古";
        priceText = `${label} ¥${price.toLocaleString("ja-JP")}`;
      }
    });
    if (!price) return; // 品切れ等（価格なし）はスキップ

    cands.push({ score: similarity(name, title), price, priceText, href, name });
  });

  // 最も近い候補を採用。誤マッチ防止に重なりが低すぎるものは捨てる。
  const b = cands.sort((a, z) => z.score - a.score)[0];
  if (!b || b.score < 0.4) return null;

  const productUrl = b.href.startsWith("http") ? b.href : `${BASE}${b.href}`;
  return {
    price: b.price,
    priceText: b.priceText,
    url: productUrl.split("?")[0],
    source: "surugaya",
    matchedName: b.name,
  };
}
