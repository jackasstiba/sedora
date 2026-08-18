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
// 「個別商品ページか」の定義は itemFilter.ts の productUrlKey ただ1つ（重複解消と同じ物差し）。
import { productUrlKey } from "../lib/itemFilter";
import { franchiseAliases } from "../lib/franchise";


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

/**
 * **掲載する根拠が無いホスト**の画像か（＝商品画像であっても採らない）。
 *
 * Amazon の商品画像は、アソシエイト・プログラム（PA-API）の参加者が定められた方法で使う
 * もので、当サイトは参加していない＝借りてよい根拠が1つも無い。ホットリンクしていた頃も
 * 灰色だったが、2026-08-18 に画像を**自ドメイン経由で配る**ようにしたことで、自分の
 * サーバから再配布する形になった＝より明確に外れる。実測48件を落として取得も止めた。
 *
 * 「商品画像ではない」(isGenericImageUrl) とは別の理由なので、判定も別に持つ。
 */
export function isUnlicensedImageHost(url: string): boolean {
  return /(^|\.|\/\/)(m\.)?media-amazon\.com|images-amazon\.com|amazon\.co\.jp\/images/i.test(url);
}

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

/**
 * その画像は「**応募先の店が出した告知**」から借りたものか（＝商品写真ではない）。
 *
 * 直す対象（実測 2026-08-18・本人指摘「この商品の画像おかしいな」/items/75417）:
 * カードの写真が **カードラボ京都店のブログ記事に貼られた「抽選予約」の文字バナー**（600x374 PNG）
 * だった。同じ型が表示中に **8件**（c-labo のブログ 2件・livepocket の抽選イベント画像 6件）。
 *
 * なぜ入り込むか: 店舗別抽選の行（card_chusen）は `item.url` が**その日の代表店の応募ページ**で、
 * 締切が過ぎるたびに**別の店に入れ替わる**。画像の後付けは「リンク先のページの og:image」を
 * 採るので、リンク先がたまたま店のブログ記事だった日には、その店の告知バナーが商品写真として
 * 焼き付く。しかも画像は一度入ると「画像なし」の対象から外れるので、**二度と見直されない**。
 *
 * 判定: 画像のホストが、この行の応募先のどれかと同じ **かつ** その応募先が**個別商品ページでない**
 * （＝店の告知・イベントページ）。応募先が個別商品ページ（プレバンの `/item/…` 等）なら、
 * そこの画像は本物の商品写真なので触らない。
 */
export function isStoreNoticeImage(
  imageUrl: string | null | undefined,
  stores: { url: string | null }[] | null | undefined
): boolean {
  const ih = imageHost(imageUrl);
  if (!ih || !stores?.length) return false;
  return stores.some((s) => s.url && imageHost(s.url) === ih && !productUrlKey(s.url));
}

function imageHost(u: string | null | undefined): string | null {
  try {
    return u ? new URL(u).hostname.replace(/^www\./, "").toLowerCase() : null;
  } catch {
    return null;
  }
}

/** 新しく採用してよい候補か（＝汎用画像でなく、画像として取得できる形をしている）。 */
export function isUsableImageCandidate(url: string): boolean {
  if (isGenericImageUrl(url)) return false;
  if (isUnlicensedImageHost(url)) return false;
  if (IMAGE_EXT_RE.test(url)) return true;
  // 拡張子が無くても、画像CDNの動的URL（Amazon/楽天/Shopify等）は許す。
  return /media-amazon\.com|image\.rakuten\.co\.jp|\.shopify\.com|cloudfront|imgix|\/image\b/i.test(url);
}

/** `key` は「同一商品だと証明できる識別子」（JAN）。複数行が同じ画像になったときの判定に使う。 */
export type ImageCandidate = { url: string; via: string; key?: string };

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

/** Amazon の商品ページから主画像を取る（Amazon は og:image を出さない）。
 *  ※ 2026-08-18 から**使っていない**（isUnlicensedImageHost の理由）。判定の説明のために残す。 */
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
    // Amazon の主画像を取る経路は 2026-08-18 に停止（isUnlicensedImageHost）。
    // 取っても isUsableImageCandidate で落ちるので、無駄に本文を舐めない。
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
  /^(再販|再販分|再入荷|再入荷分|追加入荷|追加入荷分|入荷分|購入権|購入権チケット|購入権抽選|抽選|抽選販売|抽選受付中|受付中|予約|予約販売|予約受付中|応募|数量限定|など|など多数|新品|中古|未開封|送料無料|正規品|即納)$/;

/**
 * 市場を検索するときの語。**販売条件の注記を落としてから投げる。**
 * これを入れないと「ポケモンカードゲーム MEGA 拡張パック「アビスアイ」（再入荷分）」のように
 * こちらが付けた注記ごと検索してヒット0になり、**商品は普通に売っているのに画像が取れない**
 * （実測 2026-08-16: カード抽選12件がこれ。同じ商品が別ソースからは画像付きで載っていた）。
 */
export function searchQueryName(title: string): string {
  let s = title;
  // ① **末尾の括弧が販売条件だけを言っているなら、括弧ごと落とす。**
  //
  //   以前は括弧の中の**語だけ**を消していたので、
  //   「…「メガブレイブ」（再販・おひとり様1BOXまで）」→「…「メガブレイブ」 ・おひとり様 まで）」
  //   という**壊れた断片**が検索語に残り、楽天に投げても商品に当たらなかった
  //   （実測 2026-08-18: 店舗別トレカ抽選18件が画像ゼロ。括弧を丸ごと落とすと当たる）。
  //
  //   閉じ括弧が無い形も拾う。収集元（店のX投稿）でタイトルが途中で切れ、
  //   「（事前抽選による」「（お1人様」のまま入っていることが実際にある。
  //   **末尾に限る**のが肝で、商品名の途中の括弧（「ちいかわ（ハチワレ）」等）は触らない。
  for (let i = 0; i < 3; i++) {
    const m = s.match(/[（(]([^（()）]*)[)）]?\s*$/);
    if (m?.index === undefined || !SALE_CONDITION_RE.test(m[1])) break;
    s = s.slice(0, m.index).trim();
  }
  // ② 括弧に入っていない販売条件の語も落とす。
  return s
    .replace(
      /[（(【\[]?\s*(再販分|再販|再入荷分|再入荷|追加入荷分|追加入荷|購入権抽選|購入権チケット|購入権|抽選販売|予約販売|数量限定|1BOX|1box)\s*[)）】\]]?/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 括弧の中身が「その店の売り方」だけを言っているか（＝商品の同一性に関係しない）。
 * 商品名の一部である括弧を巻き込まないよう、**販売条件でしか使われない語**に限る
 * （「限定」は「【限定販売】ねんどろいど…」のように商品名側にも出るので入れない）。
 */
const SALE_CONDITION_RE =
  /再販|再入荷|追加入荷|購入権|抽選|予約|お一人様|おひとり様|おひとりさま|お1人様|1人\d|[0-9]+\s*(?:BOX|box|個|点|パック)まで|税込|税抜|現金|シュリンク|開封|事前|先着|購入制限|数量限定/;

// 対象商品そのものではなく「その商品の付属品」を売る出品（画像が別物になる）。
const ACCESSORY_RE = /スリーブ|プロテクター|ローダー|バインダー|デッキケース|収納ケース|保護|ホルダー|ポスター専用/;

/** 商品の種別しか言っていない語（どの弾かを決めない）。 */
const CATEGORY_WORDS =
  /カードゲーム|トレーディングカード|ブースターパック|拡張パック|スタ[ーあ]?タ[ーあ]?デッキ|トライアルデッキ|関連商品|各種|新商品|グッズ|フィギュア|ぬいぐるみ|プラモデル|セット|カード|人気|話題|注目|新作|最新|おすすめ/g;

/**
 * その商品名は「どの商品か」を決められるか。**シリーズ名＋商品の種別しか無い名前**は決められない。
 *
 * 実測 2026-08-18: nyuka_now の `ONE PIECE カードゲーム`（まとめ記事の見出しがそのまま商品名に
 * なっている行）に、**OP-17 の箱写真**が付いた。`productNameMatches` は「query の全語が候補名に
 * 入っているか」を見るので、query が一般語だけだと**具体的な商品名すべてに一致してしまう**
 * （「ONE PIECE」「カードゲーム」はどの弾の名前にも入っている）。特徴語の長さで足切りしても
 * 「カードゲーム」は6字あるので通る＝長さでは防げない。
 *
 * → 作品名（`franchise.ts` の別名）と商品種別を落として**何も残らない**なら、画像は付けない。
 *   ここで諦めた行は NoImage タイルのままになるが、**別商品の写真が付くより良い**
 *   （[[UIラベルは裏取り済みのみ約束]]）。
 *
 * ⚠️ この判定は **「検索結果から写真を借りてよいか」専用**。`productNameMatches` 自体には
 * 入れない。あちらは「この2行は同じ商品か」の判定にも使われており（`keepableSameProduct`）、
 * そちらでは作品名だけの行も**比較の相手**として成立する必要がある。
 */
export function isTooGenericForImageSearch(query: string): boolean {
  let rest = query;
  for (const alias of franchiseAliases(query)) rest = rest.split(alias).join(" ");
  rest = rest.replace(CATEGORY_WORDS, " ");
  return nameTokens(rest).filter((t) => t.length >= 2).length === 0;
}

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

  // 収集元が商品名の**頭に付ける略号**（実測: ガンプラ再販カレンダーの「ACB アクションベース 8」
  // ＝ACB、「30MS OP オプションパーツセット29」＝OP）は、店の商品名には入っていない。
  // **先頭の英数ブロックにある3字以下の語1つ**に限り、一致しなくても許す。
  // 位置を限るのが肝: 「ONEPIECE カードゲーム 4th Anniversary Set」の "Set" のように**後ろの**
  // 短い語を許すと、攻略ガイド本を「Anniversary Set」の写真として借りてしまう（実測）。
  const firstJp = tokens.findIndex((t) => /[ぁ-んァ-ヶ一-龠]/.test(t.n));
  const leadEnd = firstJp === -1 ? 0 : firstJp;
  let skippedLeadCode = false;

  for (const [i, t] of tokens.entries()) {
    if (cand.includes(t.n)) continue;
    // 日本語の複合語は表記が縮む（ポケモンカードゲーム → ポケモンカード）。先頭4字での一致を許す。
    if (/[ぁ-んァ-ヶ一-龠]/.test(t.n) && t.raw.length >= 5 && cand.includes(t.n.slice(0, 4))) continue;
    if (!skippedLeadCode && i < leadEnd && tokens.length >= 3 && /^[a-z0-9]{2,3}$/.test(t.n)) {
      skippedLeadCode = true;
      continue;
    }
    return false;
  }
  return true;
}

/**
 * 商品を一意に指す型番（`OP-17` / `ST-30` / `SV11B`）。
 * 商品名の**長さ**では特定性を測れない（「ONE PIECE カードゲーム」は長いが作品名でしかない）。
 */
export function identityCodes(name: string): string[] {
  const t = name.normalize("NFKC").toLowerCase();
  return [...new Set((t.match(/[a-z]{2,5}-?\d{1,3}(?![a-z0-9])/g) ?? []).map((c) => c.replace("-", "")))];
}

/**
 * **同じ画像を共有してよい行はどれか**（商品名の集合 → 行ごとの可否）。
 *
 * 画像を付ける側（scripts/backfillImages.ts）と、付いた結果を検査する側
 * （scripts/audit.ts の image_shared）の**唯一の定義**。以前は同じ趣旨の式が
 * 両方に別々に書かれていて、付ける側だけ直した瞬間に**正しい付与を検査が誤報した**
 * （実測 2026-08-18: ONE PIECE【OP-17】8件・ストームエメラルダ4件が ERROR）。
 * [[System/rules]] 観点K「機能を広げたら、その機能を見ている検査も同時に開く」の再発なので、
 * 置き場所を1つにして構造的に起きないようにする。
 *
 * 判定:
 *  ・比較の前に `searchQueryName` で**店の売り方**（「（お1人様1BOX）」等）を落とす。
 *    条件込みで比べるとどの2つも互いに含まない＝別商品と判定される。
 *  ・全員の名前を含む「代表名（hub）」が無ければ全員 false（＝バナーか、別商品同士）。
 *  ・hub が型番を持つなら、**その型番を持つ行だけ** true（作品名しか無い行を弾く唯一の根拠。
 *    実測: OP-17 の箱写真に、12月のプレバン限定品「ONE PIECE カードゲーム」が紛れ込んだ）。
 *  ・hub が型番を持たないなら、**全ペア一致を要求**する（緩めない）。
 */
export function keepableSameProduct(rawNames: string[]): boolean[] {
  const names = rawNames.map((n) => searchQueryName(n));
  const hub = names.find((h) => names.every((n) => productNameMatches(n, h)));
  if (hub === undefined) return names.map(() => false);

  const codes = identityCodes(hub);
  if (codes.length === 0) {
    const allPairs = names.every((a, i) =>
      names.every((b, j) => i === j || productNameMatches(a, b) || productNameMatches(b, a))
    );
    return names.map(() => allPairs);
  }
  return names.map((n) => {
    const mine = identityCodes(n);
    return codes.every((c) => mine.includes(c));
  });
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

/**
 * 検索結果から、商品名が一致するものの画像を1枚選ぶ（一致が無ければ null）。
 * **作品名と種別しか無い名前では借りない**（`isTooGenericForImageSearch`。一般語だけの名前は
 * どの弾の商品名にも一致するので、検索1位の写真がそのまま焼き付く。実測 #91599）。
 */
export function pickListedImage(html: string, productName: string, limit = 8): ImageCandidate | null {
  if (isTooGenericForImageSearch(productName)) return null;
  for (const p of parseRakutenItemList(html).slice(0, limit)) {
    if (!productNameMatches(productName, p.name)) continue;
    if (!isUsableImageCandidate(p.image)) continue;
    return { url: p.image, via: "listed" };
  }
  return null;
}

/** 画像URLに埋まっている商品コード(JAN)。楽天の店は商品コードをファイル名にすることが多い。 */
export function imageUrlJan(url: string | null | undefined): string | null {
  return url?.match(/(?<![0-9])(4[59][0-9]{11})(?![0-9])/)?.[1] ?? null;
}

/**
 * **同じ商品コードの画像が、別商品の行に付いていないか。**
 *
 * 既存の `image_shared` は「同じ画像URLが3件以上」で見ており、しかも
 * **URLにJANが入っていたら同一商品とみなして素通り**させている（コードで特定した画像だから、
 * という前提）。実測 2026-08-18 に、その前提が崩れる形が出た:
 * Amazon の商品ページに載っていた唯一のJANが**カルーセルの別商品のもの**で、
 * 「御三家カードセット」に「スタートデッキ100」の写真が付いた。このとき2つの行の画像URLは
 * **別の店のサムネイル**（`yum-yum/…` と `auc-ookawaya/…`）なので、URLでは一致せず素通りする。
 * 一致するのは**URLの中のJANだけ**。
 *
 * → 画像URLのJANで束ね、その束に**同じ商品と言えない行**が混ざっていたら指摘する。ネットに出ずに判定できる。
 *
 * 判定は `keepableSameProduct`（＝画像を付ける側のゲート）**より緩くする**。あちらは
 * 「全語が入っているか」なので、収集元ごとの表記ゆれで簡単に不一致になる（実測:
 * 「ドラゴンボール**超**カードゲーム…」と「ドラゴンボール **スーパー**カードゲーム…」は
 * 同じ商品で、同じ写真が付いているのが正解）。ここは**指摘する側**なので、
 * **特徴語（4字以上）を1つも共有しない**＝どう読んでも別商品、という所まで絞る。
 * 迷ったら黙る（誤報を出すと、この検査自体が「またこれか」で読まれなくなる）。
 */
export function conflictingJanImages<T>(
  rows: T[],
  imageUrl: (r: T) => string | null | undefined,
  name: (r: T) => string
): { jan: string; rows: T[] }[] {
  const byJan = new Map<string, T[]>();
  for (const r of rows) {
    const jan = imageUrlJan(imageUrl(r));
    if (!jan) continue;
    byJan.set(jan, [...(byJan.get(jan) ?? []), r]);
  }
  const keyTokens = (s: string) => new Set(nameTokens(s).filter((t) => t.length >= 4));
  const out: { jan: string; rows: T[] }[] = [];
  for (const [jan, a] of byJan) {
    if (a.length < 2) continue;
    const toks = a.map((r) => keyTokens(name(r)));
    const apart = toks.some((x, i) =>
      toks.some((y, j) => i !== j && ![...x].some((t) => y.has(t)))
    );
    if (apart) out.push({ jan, rows: a });
  }
  return out;
}

/**
 * ページ内で一意に決まる JAN/EAN（日本の商品コードは 45/49 始まりの13桁）。
 * 2つ以上あるページはどの商品のコードか決められないので null（＝使わない）。
 *
 * ⚠️ **「一意＝その商品のコード」ではない。** Amazon は自分の商品を ASIN で表すので本文にJANが
 * 出ないことがあり、そのとき**カルーセルの関連商品のJANだけ**がページに残る（実測 2026-08-18・
 * #92497）。ここを通ったコードは `imageByJan` 側で**商品名の全語一致**にかけてから使う。
 */
export function extractSoleJan(html: string): string | null {
  const count = new Map<string, number>();
  for (const m of html.matchAll(/(?<![0-9])(4[59][0-9]{11})(?![0-9])/g))
    count.set(m[1], (count.get(m[1]) ?? 0) + 1);
  if (count.size === 0) return null;
  if (count.size === 1) return [...count.keys()][0];
  // 複数あっても、**桁違いに多く出るもの**はその記事の商品（各通販への検索リンクが並ぶので
  // 本文の商品コードは何度も出る）。関連記事やサイドバーのコードは1〜2回しか出ない。
  // 実測 2026-08-16: トレカ速報・ちゃんねらー速報の記事で本文の商品コードが20回前後出ていた。
  const [top, second] = [...count.entries()].sort((a, b) => b[1] - a[1]);
  return top[1] >= 3 && top[1] >= second[1] * 2 ? top[0] : null;
}
