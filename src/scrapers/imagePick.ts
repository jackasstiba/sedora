/**
 * 「掲載しているリンク先のページから、その商品の画像を1枚選ぶ」ための純関数群。
 *
 * なぜ独立させたか: 画像の後付け(`scripts/backfillImages.ts`)は元々 channeltono/rarecheck
 * 決め打ちで、**それ以外のソースは imageUrl=null のまま誰も触らない**状態だった
 * （実測 2026-08-15: 表示1302件中103件が画像なし。うち nyuka_now 39/tenbaiquest 26/
 *   kujimap 16 は対象外だったため100%が画像なし）。取得手段をソースから切り離し、
 * 「ページ→画像1枚」の判断だけをここに集める。selftest で固定できるよう副作用を持たない。
 *
 * 選ぶ順序（上から先に当たったものを採用）:
 *   1. og:image / twitter:image … 大半の公式LP・ニュース記事はこれで取れる
 *   2. JSON-LD の Product.image … 商品ページで og を持たないもの
 *   3. Amazon の hiRes/data-old-hires … Amazon は og:image を出さないが商品画像は素で入っている
 *   4. 本文の投稿画像（/uploads/ 等） … og を持たない小規模CMS（kujist・fancy-fukuya 等）
 *
 * **採らない**もの（＝間違った画像を出すくらいなら NoImage タイルのままにする）:
 *   ・サイト共通の OGP/ロゴ/バナー（下の GENERIC_IMAGE_RE と「トップページと同じ画像か」で落とす）
 *   ・検索結果ページの1件目（商品名が一致しない限り別商品。実測: 「INSTINCTOY SHOW TOKYO 2026」の
 *     楽天検索1位は菅田将暉のBlu-rayだった）
 */

/** meta[property|name=prop] の content（属性の順序どちらでも拾う）。 */
export function pickMeta(html: string, prop: string): string | null {
  const p = prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m =
    html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']+)["']`, "i")) ||
    html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${p}["']`, "i"));
  return m ? decodeEntities(m[1].trim()) : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]{1,6});/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d{1,7});/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"');
}

/** 相対URL・プロトコル相対URLをページURL基準の絶対URLにする。取れなければ null。 */
export function absolutize(src: string, pageUrl: string): string | null {
  try {
    const u = new URL(decodeEntities(src.trim()), pageUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * 商品画像ではない汎用画像（サイトロゴ・共通バナー・SNS共有用OGP・アイコン・「画像なし」画像）。
 * 実測で踏んだもの:
 *   ・sitelogo.png（イトーヨーカドー）/ ogp.png（麦わらストア・グッスマくじ）
 *   ・loft_snsshare.png / famima_online.jpg（/assets/img/share/配下）
 *   ・Binoculars-256.png（rarecheck が featured image 未設定の記事に返すアイコン）
 *   ・**no-image_150x150.png（トレカ速報 40件）/ no-image/master-packs/empty.png（トレカマップ 8件）**
 *     ＝収集元が「画像なし」として配る定型画像。imageUrl は埋まっているので「画像あり」に
 *     数えられ、灰色の他所サイトの画像なしタイルがそのまま並んでいた（2026-08-15 実測）。
 *   ・pbs.twimg.com/profile_images/…（Xアカウントのアイコン。商品ではないうえ巡回先が割れる）
 */
export const GENERIC_IMAGE_RE =
  /binoculars|no[-_]?image|noimage|nophoto|default|placeholder|logo|icon|avatar|gravatar|blank|dummy|sprite|ogp|og[-_]?image|snsshare|sns[-_]|share[-_/]|\/share\/|banner|bnr\d|\/common\/|\/themes?\/|\/assets\/img\/(?:common|share)\/|profile_images|\/empty\.|\/uploads\/201[0-8]\//i;

/** 画像として使える拡張子か（トラッキング用の1x1 gif や広告配信URLを弾く）。 */
const IMAGE_EXT_RE = /\.(?:jpe?g|png|webp|avif|gif)(?:[?#]|$)/i;

/** 広告・計測・アフィリエイトの配信ホスト（商品画像ではない）。 */
const AD_HOST_RE =
  /a8\.net|linksynergy|accesstrade|valuecommerce|afl\.rakuten\.co\.jp|doubleclick|googlesyndication|i\.imgur|parts\.blog\.livedoor\.jp/i;

/**
 * 「商品画像ではない」とURLだけで言い切れるか（ロゴ・共通バナー・画像なし画像・広告配信）。
 * **保存済み画像の掃除にも使う判定**なので、ここに拡張子の有無のような“確からしさ”の話を
 * 混ぜないこと。混ぜると、拡張子の無い正しい商品画像（実測: ONE PIECEカードゲーム公式の
 * /products/2026/06/18/… ）まで「汎用画像」と見なして消してしまう。
 */
export function isGenericImageUrl(url: string): boolean {
  return AD_HOST_RE.test(url) || GENERIC_IMAGE_RE.test(url);
}

/** 新しく採用してよい候補か（＝汎用画像でなく、画像として取得できる形をしている）。 */
export function isUsableImageCandidate(url: string): boolean {
  if (isGenericImageUrl(url)) return false;
  if (IMAGE_EXT_RE.test(url)) return true;
  // 拡張子が無くても、画像CDNの動的URL（Amazon/楽天/Shopify等）は許す。
  return /media-amazon\.com|image\.rakuten\.co\.jp|\.shopify\.com|cloudfront|imgix|\/image\b/i.test(url);
}

export type ImageCandidate = { url: string; via: string };

/** JSON-LD から「単体商品ページの Product.image」だけを取る（ItemList＝検索結果は採らない）。 */
export function pickJsonLdProductImage(html: string): string | null {
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const nodes = Array.isArray(data) ? data : [data];
    for (const n of nodes) {
      const o = n as { "@type"?: string | string[]; image?: unknown };
      const types = Array.isArray(o?.["@type"]) ? o["@type"] : [o?.["@type"]];
      if (!types.includes("Product")) continue;
      const img = Array.isArray(o.image) ? o.image[0] : o.image;
      if (typeof img === "string" && img) return img;
      if (img && typeof img === "object" && typeof (img as { url?: string }).url === "string")
        return (img as { url: string }).url;
    }
  }
  return null;
}

/** Amazon の商品ページから主画像を取る（Amazon は og:image を出さない）。 */
export function pickAmazonImage(html: string): string | null {
  const m =
    html.match(/data-old-hires="(https:\/\/[^"]+)"/) ||
    html.match(/"hiRes"\s*:\s*"(https:\/\/[^"]+)"/) ||
    html.match(/id="landingImage"[^>]*\ssrc="(https:\/\/[^"]+)"/);
  return m ? m[1] : null;
}

/** 本文の投稿画像（CMSのアップロード配下）を1枚。og を持たない小規模サイト向け。 */
export function pickContentImage(html: string, pageUrl: string): string | null {
  const UPLOAD_RE = /\/(?:wp-content\/uploads|uploads|cms-media|media|files\/images|img\/goods|item)\//i;
  for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
    const abs = absolutize(m[1], pageUrl);
    if (!abs || !UPLOAD_RE.test(abs)) continue;
    if (!isUsableImageCandidate(abs)) continue;
    return abs;
  }
  return null;
}

/** ページHTMLから商品画像の候補を1枚選ぶ。使えるものが無ければ null。 */
export function pickPageImage(html: string, pageUrl: string): ImageCandidate | null {
  const tries: [string, string | null][] = [
    ["og:image", pickMeta(html, "og:image") ?? pickMeta(html, "og:image:secure_url")],
    ["twitter:image", pickMeta(html, "twitter:image") ?? pickMeta(html, "twitter:image:src")],
    ["jsonld", pickJsonLdProductImage(html)],
    ["amazon", pickAmazonImage(html)],
    ["content", pickContentImage(html, pageUrl)],
  ];
  for (const [via, raw] of tries) {
    if (!raw) continue;
    const abs = absolutize(raw, pageUrl);
    if (!abs || !isUsableImageCandidate(abs)) continue;
    return { url: abs, via };
  }
  return null;
}

// ── 商品名の一致判定（検索結果から画像を借りるときの唯一の根拠） ─────────────
//
// 検索結果の1位を無条件に使うと平気で別商品を出す（実測: 「INSTINCTOY SHOW TOKYO 2026」の
// 楽天検索1位＝菅田将暉のBlu-ray）。**商品名の要素が全部入っている候補**だけを採る。

/** 比較用の正規化（全角→半角・小文字・記号と空白を除去）。 */
export function normalizeName(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[“”"'‘’『』「」【】〈〉《》\[\]()（）]/g, "")
    .replace(/[\s　]+/g, "")
    .replace(/[・･,、.。/\\|:：;；!！?？~〜ー\-—–_+*#@&＆]/g, "");
}

/**
 * 商品名を「英数の語」と「日本語の語」に割る。
 * **語は候補名と同じ正規化を通す**（`normalizeName`）。ここを揃えないと、長音「ー」を落として
 * 比較しているのに語だけ「ー」付きのままになり、**長音を含む語が全部外れる**
 * （実測 2026-08-16: 「サンダース」「スカーレット」「カラー」等。ガンプラ再販44件は
 *  検索1位が正解の商品だったのに1件も一致しなかった）。
 */
export function nameTokens(s: string): string[] {
  return rawTokens(s).map((t) => normalizeName(t)).filter((w) => w.length >= 2);
}

/** 正規化前の語（長さの判定に使う。正規化は長音などを落とすので字数が変わる）。 */
function rawTokens(s: string): string[] {
  const t = s.normalize("NFKC").toLowerCase();
  return [...t.matchAll(/[a-z0-9]+|[ぁ-んァ-ヶー一-龠]+/g)]
    .map((m) => m[0])
    .filter((w) => w.length >= 2 && !NON_IDENTITY_TOKEN.test(normalizeName(w)));
}

// 商品の同一性に関係しない語（こちらが付けた販売条件・告知、出品側の売り文句）。
// 一致の条件から外す。実測: 「…【ST-30】（再販分）」「…【OP-17】購入権チケット」は
// こちらの注記で、正しい商品の出品には当然入っていない。
const NON_IDENTITY_TOKEN =
  /^(再販|再販分|購入権|購入権チケット|抽選|抽選受付中|受付中|予約|予約受付中|応募|など|など多数|新品|中古|未開封|送料無料|正規品|即納)$/;

// 対象商品そのものではなく「その商品の付属品」を売る出品（画像が別物になる）。
const ACCESSORY_RE = /スリーブ|プロテクター|ローダー|バインダー|デッキケース|収納ケース|保護|ホルダー|ポスター専用/;

/**
 * `candidate`（検索結果の商品名）が `query`（掲載中の商品名）と同じ商品を指すか。
 * 判定は厳しめ＝迷ったら false。false のときは画像を付けない（NoImageのまま）。
 */
export function productNameMatches(query: string, candidate: string): boolean {
  const cand = normalizeName(candidate);
  if (!cand) return false;
  if (ACCESSORY_RE.test(candidate) && !ACCESSORY_RE.test(query)) return false;

  // 長さ（＝どれだけ特徴的か）は**正規化前**で測り、一致は正規化後で見る。
  // 正規化は長音などを落とすので、同じ語でも字数が変わる（「ギラーガ」4字→「ギラガ」3字）。
  // 縮んだ字数で特徴語を判定すると、商品を一意に指す語まで「一般語」として捨ててしまう。
  const tokens = rawTokens(query).map((raw) => ({ raw, n: normalizeName(raw) })).filter((t) => t.n.length >= 2);
  // 語が1つのときは、それ自体が十分に特徴的（6字以上）なときだけ認める。
  // 実測: 「君臨のヘッドライナー」は1語でも商品を一意に指す。「零式」だけでは指さない。
  if (tokens.length === 0) return false;
  if (tokens.length === 1 && tokens[0].raw.length < 6) return false;
  // 「30th」「celebration」のような特徴語が最低1つ要る（一般語だけの一致を防ぐ）。
  if (!tokens.some((t) => t.raw.length >= 4)) return false;

  for (const t of tokens) {
    if (cand.includes(t.n)) continue;
    // 日本語の複合語は表記が縮む（ポケモンカードゲーム → ポケモンカード）。先頭4字での一致を許す。
    if (/[ぁ-んァ-ヶ一-龠]/.test(t.n) && t.raw.length >= 5 && cand.includes(t.n.slice(0, 4))) continue;
    return false;
  }
  return true;
}

export type ListedProduct = { name: string; image: string; url: string };

/** 楽天の検索結果ページの JSON-LD（ItemList）から候補（商品名・画像）を取り出す。 */
export function parseRakutenItemList(html: string): ListedProduct[] {
  const out: ListedProduct[] = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const o = data as { "@type"?: string; itemListElement?: { item?: { name?: string; image?: string[] | string; url?: string } }[] };
    if (o?.["@type"] !== "ItemList" || !Array.isArray(o.itemListElement)) continue;
    for (const el of o.itemListElement) {
      const it = el?.item;
      if (!it?.name) continue;
      const img = Array.isArray(it.image) ? it.image[0] : it.image;
      if (typeof img !== "string" || !img) continue;
      out.push({ name: it.name, image: img, url: it.url ?? "" });
    }
  }
  return out;
}

/** 検索結果から、商品名が一致するものの画像を1枚選ぶ（一致が無ければ null）。 */
export function pickListedImage(html: string, productName: string, limit = 8): ImageCandidate | null {
  for (const p of parseRakutenItemList(html).slice(0, limit)) {
    if (!productNameMatches(productName, p.name)) continue;
    if (!isUsableImageCandidate(p.image)) continue;
    return { url: p.image, via: "listed" };
  }
  return null;
}

/**
 * ページ内で一意に決まる JAN/EAN（日本の商品コードは 45/49 始まりの13桁）。
 * 2つ以上あるページはどの商品のコードか決められないので null（＝使わない）。
 */
export function extractSoleJan(html: string): string | null {
  const found = new Set<string>();
  for (const m of html.matchAll(/(?<![0-9])(4[59][0-9]{11})(?![0-9])/g)) found.add(m[1]);
  return found.size === 1 ? [...found][0] : null;
}
