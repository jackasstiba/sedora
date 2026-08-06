import * as cheerio from "cheerio";

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

/**
 * 「商品名」が個別商品(SKU)ではなく**商品ラインの総称**になるソース。
 * 抽選アグリは「ポケモンカード」「ガンダムカードゲーム」のような括りで各店の抽選をまとめるため、
 * そこに特定商品の値段を付けると別物の値段を相場として断定することになる
 * （実測: 「ドラゴンボールスーパーカードゲーム フュージョンワールド」に 2nd ANNIVERSARY SET の
 * ¥66,000、次いでミニスタートデッキの¥160 が付いた）。相場付与の対象外にする。
 */
export const LINE_LEVEL_SOURCES = new Set(["nyuka_now", "tenbaiquest"]);

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

// ── 販売単位（カートン/BOX/単品）の一致チェック ────────────────────────────────
// 誤マッチの主因: 類似度が inter/min(...) なので、こちらの商品名を**丸ごと含む上位単位**の
// 商品（「… [1カートン]」）が満点に近いスコアで必ず勝つ。結果、定価440円の1パックに
// カートンの ¥86,592 が「相場」として付き、プレ値ランキングの上位を誤りが占めていた
// （実測: バトスピ/ウィクロス/アビスアイ）。単位が自分より大きい候補は採らない。
export type PackUnit = "carton" | "box" | "single";

export function packUnit(name: string): PackUnit {
  const n = norm(name);
  if (/カートン|\d+box/.test(n)) return "carton";
  // 「セット」「アタッシュケース」等の同梱品は、単品より上位の別商品
  //（実測: 単品の「拡張パック ロケット団の栄光」に「アタッシュケースセット」¥34,800 が付いた）。
  // 英字の SET は単語として見る（norm はスペースを消すので原文で判定。実測:
  // 「フュージョンワールド」に「2nd ANNIVERSARY SET プレミアムバンダイ限定」¥66,000 が付いた）。
  if (/box|ボックス|\d+パック入|セット|アタッシュケース|コンプリート/.test(n)) return "box";
  if (/\b(?:set|bundle)\b/i.test(name)) return "box";
  return "single";
}

const UNIT_RANK: Record<PackUnit, number> = { single: 0, box: 1, carton: 2 };

/** 誤マッチ防止：商品名とハツコレ側タイトルの2-gram重なり率 */
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

// ── 核トークン検証（同シリーズの別商品への誤マッチ防止） ──────────────────────
// 2-gram 類似度だけでは「MTG ホビット コレクター・ブースター 日本語版」と
// 「MTG ミュータント タートルズ コレクター・ブースター 日本語版」が 0.57 で通ってしまう
// （実測）。作品名は文字列全体のごく一部なので、類似度では原理的に分離できない。
// → 検索結果の中での**出現頻度**で一般語と識別語を自動判別し、識別語（ホビット・兄妹の鬼）を
//   含まない候補は捨てる。辞書を持たずに済み、ジャンルが増えても腐らない。
// 見つからなければ相場を出さない（誤った相場を出すより、出さない方が正しい）。

// 販売単位・版・状態は商品の識別語ではなく構造語なので、識別語の判定から除く
// （単位は packUnit で別途担保。「12パック入りBOX」を識別語にすると正しいBOXまで落ちる）。
const STRUCTURAL_TOKEN =
  /^(?:box|ボックス|カートン|\d*パック入り?|パック|セット|日本語版|英語版|中古|新品|予約|定価|税込|\d+個入り?|\d+枚入り?)$/;

function tokenize(s: string): string[] {
  return s
    // 括弧類は収集元ごとに書き方が違う（《無私の守美者》↔<<無私の守美者>>）ので、
    // 中身を同じ語として扱えるよう全て区切りにする。
    .replace(/[【】\[\]「」『』〔〕〈〉《》≪≫<>“”‘’"'（）()〜～\-–—|｜,，.。!！?？:：/／+＋×]/g, " ")
    .split(/[\s　]+/)
    .map((t) => norm(t))
    .filter((t) => t.length >= 2 && !STRUCTURAL_TOKEN.test(t));
}

/**
 * 検索結果全体で見て「その商品を特定している語」だけを返す。
 * 候補の半分以上に出る語＝そのジャンルの一般語（ブースター/コレクター/MTG）なので落とす。
 */
export function distinctiveTokens(title: string, candidateNames: string[]): string[] {
  const toks = [...new Set(tokenize(title))];
  if (candidateNames.length === 0) return toks;
  const df = (t: string) => candidateNames.filter((n) => norm(n).includes(t)).length;
  return toks
    .filter((t) => df(t) / candidateNames.length <= 0.5)
    // 最も珍しい語＝その商品を最も強く特定する語（セット名・型番）を先頭に置く。
    .sort((a, b) => df(a) - df(b) || b.length - a.length);
}

/** タイトルで駿河屋を検索し、最も近い商品の中古/新品価格を返す。無ければ null。 */
export async function fetchSurugayaPrice(title: string): Promise<MarketPrice | null> {
  const q = toQuery(title);
  if (q.length < 3) return null;
  const url = `${BASE}/search?category=&search_word=${encodeURIComponent(q)}`;

  // 駿河屋は検索0件のとき HTTP 404 を返す＝「該当なし（相場なし）」で null。
  // 一方タイムアウトや5xxは**一時的な失敗**であり、これを null（＝相場なし）と混同すると
  // 呼び出し側が既存の相場を消してしまう。通信失敗は throw して呼び出し側に据え置かせる。
  let html: string;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; HatsukoreBot/1.0)" },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 404) return null; // 該当商品なし（未発売・取扱なし）
    if (!res.ok) throw new Error(`surugaya ${res.status}`);
    html = await res.text();
  } catch (e) {
    throw new Error(`surugaya fetch failed: ${(e as Error).message}`);
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

    // 実売の「中古/新品」価格だけを相場として採る。
    // ・「定価」行は相場ではない。
    // ・「予約」は未発売品の販売予定価格＝ほぼ定価であって“売れている値段”ではない。
    //   これを拾うと「相場・プレ値ランキング」に定価が並び、しかもラベル既定値のせいで
    //   「中古 ¥86,592」と実体のない断定表示になっていた（実測）。ラベルは推測せず、
    //   明示された種別だけを信じる（[[UIラベルは裏取り済みのみ約束]]）。
    // ・「買取」は駿河屋が買い取る値段で売値ではないので相場としては出さない。
    let price = 0;
    let priceText = "";
    $it.find("p.price_teika").each((__, p) => {
      const txt = $(p).text().replace(/\s+/g, " ").trim();
      const m = txt.match(/(中古|新品|予約|買取|定価)\s*[：:]\s*[¥￥]?\s*([0-9,]+)/);
      if (!m || price) return;
      const label = m[1];
      if (label !== "中古" && label !== "新品") return;
      price = Number(m[2].replace(/,/g, ""));
      priceText = `${label} ¥${price.toLocaleString("ja-JP")}`;
    });
    if (!price) return; // 品切れ・予約のみ（実売価格なし）はスキップ

    cands.push({ score: similarity(name, title), price, priceText, href, name });
  });

  // 販売単位が自分より大きい候補（1パックに対するBOX・カートン）は別商品なので捨てる。
  const ownUnit = packUnit(title);
  let pool = cands.filter((c) => UNIT_RANK[packUnit(c.name)] <= UNIT_RANK[ownUnit]);

  // 識別語（作品名・シリーズ名・型番）を1つでも含む候補だけに絞る＝同ジャンルの別商品を弾く。
  // 「全て含む」は厳しすぎた（駿河屋は商品名の付け方が違い、こちらにある語を省くことがある。
  // 実測: スリーブ9件の正しいマッチを落とした）。1つでも一致すれば作品は特定できる。
  const keys = distinctiveTokens(title, cands.map((c) => c.name));
  // 識別語が1つも無い＝タイトルが一般名すぎて商品を特定できない（抽選情報の「ポケモンカード」
  // 「ガンダムカードゲーム」等）。ここで上位候補を採ると、無関係の商品の値段を
  // その商品の相場として断定することになるので、相場は出さない。
  if (keys.length > 0) {
    // 判定に使うのは**最も珍しい識別語**（セット名・型番）1つ。
    // 「どれか1つでも一致」は緩すぎた（シリーズ名だけ合った別商品が通る。実測:「熱風のアリーナ」に
    // 別のプロモパックが¥3,980で付いた）。逆に「全て一致」は厳しすぎる（駿河屋は語を省くことがある）。
    const key = keys[0];
    pool = pool.filter((c) => norm(c.name).includes(key));
  } else {
    // 識別語ゼロ＝タイトルの語が候補全部に出ている。これは2通りある:
    //   (a) 検索結果が同一商品群に絞れている（「デッキシールド メガダークライ」）→ 採ってよい
    //   (b) タイトルが一般名すぎる（「ポケモンカード」「ガンダムカードゲーム」）→ 採ってはいけない
    // 語が2つ以上あり、その全てを含む候補だけを残すことで (a) を救い (b) を落とす。
    const toks = [...new Set(tokenize(title))];
    if (toks.length < 2) return null;
    pool = pool.filter((c) => toks.every((t) => norm(c.name).includes(t)));
  }

  // 最も近い候補を採用。誤マッチ防止に重なりが低すぎるものは捨てる。
  const b = pool.sort((a, z) => z.score - a.score)[0];
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
