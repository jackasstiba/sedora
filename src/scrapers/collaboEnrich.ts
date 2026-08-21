import { matchFranchises } from "../lib/franchise";
import { normalizeForSearch } from "../lib/itemFilter";
import { cleanStoreUrl } from "./aggregatorUtil";

// コラボイベント記事の「本文」から、せどらーが最も欲しい情報＝抽選/ランダム/数量限定の
// 有無と、注目賞品（タオル・アクスタ等）を抽出する純関数。
//
// 背景: 一覧カード由来のコラボは「開催」1行止まりで、その中の“抽選で当たる高額賞品”
// （例: ホロライブ×極楽湯の描き下ろしランダム配布マフラータオル＝メルカリ毎回20万円台）に
// たどり着けなかった。記事本文は表組みでなく散文なので A賞/B賞 の構造化抽出はできないが、
// 「抽選/ランダム」等のシグナルと賞品名詞は本文テキストから堅牢に拾える。

// 本文コンテナ #single__container 開始〜フッターウィジェット（新着一覧ナビ）手前までの
// HTML片を返す（リンク抽出などタグが要る処理のため）。
function articleBodyHtml(html: string): string {
  const start = html.indexOf("single__container");
  if (start < 0) return "";
  const foot = html.indexOf("single__foot__content", start);
  return foot > start ? html.slice(start, foot) : html.slice(start);
}

// 本文末尾の「関連記事／新着記事」ブロックの開始位置を示す定型見出し。ここ以降は
// 他イベントのタイトル（例:「ゴジラ 一番くじ」「◯◯ 抽選」）が並ぶため、そのまま本文に
// 含めると抽選/賞品シグナルを誤検出する（実測: hasLottery 誤検出の主因）。テキスト段階で切る。
const RELATED_BLOCK_START =
  /この記事を読んだ人|こんな記事も読ん|最新記事をお届け|関連記事|人気記事|新着記事|前の記事|次の記事|カテゴリー一覧|記事一覧へ/;

// 本文コンテナのテキスト（タグ除去）。ナビの見出しノイズを本文に混ぜないため区切る。
// さらに末尾の関連記事ブロック（他イベント見出しの羅列）を除去してから返す。
export function extractArticleBody(html: string): string {
  const body = articleBodyHtml(html);
  if (!body) return "";
  let text = decodeEntities(body.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  const rel = text.match(RELATED_BLOCK_START);
  if (rel && rel.index !== undefined && rel.index > 0) text = text.slice(0, rel.index).trim();
  return text;
}

// ── 開催期間の裏取り（記事本文の仕様表 → 一覧の期間の誤りを正す） ──────────────
// 背景: 一覧カードの `event-date`（期間 : …）は収集元側で誤っていることがある。
// 実例 #20308「玉之けだま カフェ in Cafe ASAN」= 一覧「8月6日〜8月16日」／記事本文の
// 開催期間・告知・タイトルはいずれも「8月8日〜8月16日」。発売日/開催日が本サイトの中核価値
// なので、記事側に**ラベル付きの完全な日付**があるときはそれを正とする（[[裏取り済みのみ約束]]）。
// 記事末尾の関連記事ブロックは他イベントの期間を含むため、必ず切り落とした本文だけを見る。
const PERIOD_LABEL = /(?:開催期間|開催日程|開催日|販売期間|実施期間|開催スケジュール)/;
const FULL_DATE = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/;

/**
 * 記事本文の「開催期間: 2026年8月8日〜8月16日」からイベント開始日と表示テキストを取り出す。
 * ラベル直後（40字以内）に西暦つきの完全な日付がある場合のみ返す＝推測しない。
 */
export function extractEventPeriod(
  bodyText: string
): { date: Date; text: string } | null {
  const m = bodyText.match(PERIOD_LABEL);
  if (!m || m.index === undefined) return null;
  const after = bodyText.slice(m.index + m[0].length, m.index + m[0].length + 40);
  const d = after.match(FULL_DATE);
  if (!d || d.index === undefined) return null;
  const [y, mo, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
  if (mo < 1 || mo > 12 || day < 1 || day > 31) return null;
  // 終了日「〜8月16日」「～2026年8月16日」が続くなら表示テキストに含める。
  const tail = after
    .slice(d.index + d[0].length)
    .match(/^\s*[〜~～\-–—]\s*(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  const text = tail
    ? `${y}年${mo}月${day}日〜${tail[2]}月${tail[3]}日`
    : `${y}年${mo}月${day}日`;
  return { date: new Date(Date.UTC(y, mo - 1, day)), text };
}

// タイトル中の日付トークン（「8月8日」「2026.8.11」「8.11」）を月日で拾う。
const TITLE_DATE_RE = /(?:\d{4}\s*[年.．]\s*)?(\d{1,2})\s*[月.．]\s*(\d{1,2})\s*日?/g;

function titleMonthDays(title: string): { mm: number; dd: number }[] {
  return [...title.matchAll(TITLE_DATE_RE)]
    .map((m) => ({ mm: Number(m[1]), dd: Number(m[2]) }))
    .filter((x) => x.mm >= 1 && x.mm <= 12 && x.dd >= 1 && x.dd <= 31);
}

/**
 * 記事本文から取れた開催期間を「採用してよいか」判定して返す。採用しないなら null。
 *
 * 本文の「開催期間」ラベルは、前売券の販売期間や併催イベントの日付を拾ってしまうことがある
 * （実測: 4件の相違のうち2件がこの型の誤り）。そこで**独立した2箇所が一致したときだけ**採る:
 *   (a) タイトルにも同じ月日が書かれている（例: #20308 タイトル「8月8日より」＝本文の開催期間）
 *   (b) 現在の日付と月日は一致し年だけ違う（例: #4771 一覧が2027年＝収集元の年の打ち間違い）
 * どちらでもなければ現状維持＝推測で日付を動かさない（[[UIラベルは裏取り済みのみ約束]]）。
 */
export function pickVerifiedEventDate(
  bodyText: string,
  title: string,
  current: Date | null
): { date: Date; text: string } | null {
  const p = extractEventPeriod(bodyText);
  if (!p) return null;
  const mm = p.date.getUTCMonth() + 1;
  const dd = p.date.getUTCDate();
  const byTitle = titleMonthDays(title).some((t) => t.mm === mm && t.dd === dd);
  const byYearTypo =
    current !== null &&
    current.getUTCMonth() + 1 === mm &&
    current.getUTCDate() === dd &&
    current.getUTCFullYear() !== p.date.getUTCFullYear();
  return byTitle || byYearTypo ? p : null;
}

// SNS・URL短縮・アフィリエイト転送は「何が売られるか」の一次情報ではないので公式候補から除外する。
// t.co 等の短縮リンクや valuecommerce 等の転送は、飛んだ先が販売ページでも中間URLが露出し、
// また転送切れ・無関係先の危険があるため候補にしない（＝販売内容ページとして提示しない）。
const SOCIAL_RE =
  // ※ `x\.com` は**必ず境界付き**で書く。境界が無いと "ex.com" "sqex.com" 等、末尾が
  //   x.com になるだけの正当なドメインを丸ごとSNS扱いで捨てる（自己テストで発覚）。
  /youtube\.com|youtu\.be|twitter\.com|(^|[./])x\.com|facebook\.com|instagram\.com|line\.me|tiktok\.com|pinterest\.|t\.co\/|bit\.ly|tinyurl|ow\.ly|goo\.gl|lnky|linksynergy|valuecommerce|a8\.net|\.a8\.|accesstrade|felmat|dpbolvw|anrdoezrs|jdoqocy|tkqlhce|hb\.afl\.rakuten|a\.r10\.to|moshimo|af\.moshimo/i;

/**
 * 記事本文から一次情報（公式キャンペーン/公式ストア）候補URLを1つ選ぶ。
 * collabo-cafe 自身とSNSを除外し、ルートだけのドメインより「具体的なパスを持つページ」や
 * store/shop/goods 系を優先する（例: rakuspa.com/hololive_yumeguritabi/ を選ぶ）。
 */
export function extractOfficialUrl(
  html: string,
  opts: { allowSingleProduct?: boolean } = {}
): string | null {
  const allowSingleProduct = opts.allowSingleProduct ?? true;
  const region = articleBodyHtml(html) || html;
  const urls = [...region.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
  let cand = urls.filter((u) => !u.includes("collabo-cafe.com") && !SOCIAL_RE.test(u));
  // イベント記事（カフェ/ポップアップ/展示＝eventType「開催」）の公式は**会場・キャンペーンの
  // ページ**であって、1点の商品ページではない。記事本文の末尾には無関係な通販商品リンクが
  // 並ぶので、URL の見た目だけで選ぶと必ずそちらが勝つ。
  //   実測(2026-08-10): 「ウマ娘 × KFC」→ ¥23,100 のコトブキヤ製フィギュア商品ページ、
  //   「入間くん 最新刊 第51巻」→ 別キャラのアクリルスタンド ¥1,210。どちらも
  //   「公式ページを見る →」の下に置かれていた。
  // 候補から除外して**次点を選び直す**（後から null にすると、正しい会場ページまで消える）。
  if (!allowSingleProduct) cand = cand.filter((u) => !isSingleProductUrl(decodeEntities(u)));
  if (!cand.length) return null;
  const score = (u: string): number => {
    let s = 0;
    try {
      if (new URL(u).pathname.replace(/\/$/, "").length > 0) s += 3; // 具体ページ
    } catch {
      return -1;
    }
    if (/store|shop|goods|\bec\b|\/item|campaign|collab|feature/i.test(u)) s += 2;
    return s;
  };
  const best = [...new Set(cand)].sort((a, b) => score(b) - score(a))[0];
  // href の値は HTML なのでエンティティのまま（`&amp;`）。デコードせずに保存すると
  // クエリ名が `amp;utm_source` になった URL を「公式ページ」として提示することになる
  // （実測: 表示中 335件のうち 119件が `&amp;` を含んでいた）。
  // さらにトラッキングを除去する。収集元記事のリンクは utm_source=collabo_cafe_dot_com の
  // ように**収集元の名前がクエリに焼き込まれている**（実測 #58615）。そのまま配ると
  // 「公式ページで見る」がソース非公開方針を自分で破る。
  return score(best) > 0 ? cleanStoreUrl(decodeEntities(best)) || null : null;
}

/**
 * officialUrl が「個別商品ページ」を指しているか。
 *
 * 個別商品ページは *その1点の商品* という強い同一性を主張する。イベント/キャンペーンの
 * 公式トップ（`/campaign/umamusume` 等）は「このコラボの公式」としか主張しないので、
 * 記事との照合が要るのは前者だけ。ここを分けないと、照合に失敗した正当なリンクまで落ちる。
 */
export function isSingleProductUrl(url: string): boolean {
  try {
    const seg = new URL(url).pathname.split("/").filter(Boolean);
    // 「/products/4934054076093」「/item/2785343」の形＝サイト直下の商品ページ。
    // 「/news/goods/mx-donki-…」のような**お知らせ配下**は商品ページではなく告知なので含めない
    // （実測: サンリオ公式の新商品ニュースを商品ページと誤判定して落としかけた）。
    return seg.length === 2 && /^(products?|item|items|goods)$/i.test(seg[0]);
  } catch {
    return false;
  }
}

// 商品名として意味を持たない語。これしか共通しない場合に「同じ商品」と言わせない。
const GENERIC_WORDS =
  /^(公式|オンライン|ショップ|ストア|通販|グッズ|商品|一覧|特集|フィギュア|ぬいぐるみ|アクリル|スタンド|キーホルダー|セット|限定|予約|販売|株式会社|anime|store|shop|online|official|goods|item)$/i;

/** ページの <title> / og:title を取り出す（取れなければ null） */
export function extractPageTitle(html: string): string | null {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const t = og?.[1] ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (!t) return null;
  const s = decodeEntities(t.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  return s || null;
}

/**
 * 記事のタイトルと、リンク先の個別商品ページのタイトルが**同じ作品を指しているか**。
 *
 * 背景（2026-08-10 実測）: collabo_cafe の officialUrl は「本文中の最良の外部リンク1つ」を
 * URL の見た目だけで選んでいるため、記事末尾の関連グッズリンクが選ばれる。
 *   ・ウマ娘 × KFC       → anime-store の ¥23,100 コトブキヤ製フィギュア商品ページ
 *   ・入間くん 最新刊51巻 → 別キャラのアクリルスタンド ¥1,210
 * どちらも「公式ページを見る」の下に置かれていた＝ユーザーが誤解して損する。
 *
 * 判定は**作品名の共有**のみで行い、商品名の細部は見ない（細部で照合すると、正当な
 * コラボグッズページまで落ちる）。取得できなかった・タイトルが読めない場合は true を返す
 * ＝分からないものを罰しない（[[System/mistakes]] ミス16「直し方の強さ」）。
 */
export function officialPageMatchesItem(itemTitle: string, pageTitle: string | null): boolean {
  if (!pageTitle) return true;
  const a = normalizeForSearch(itemTitle);
  const b = normalizeForSearch(pageTitle);
  const fa = matchFranchises(itemTitle);
  const fb = matchFranchises(pageTitle);
  if (fa.length && fb.length) return fa.some((g) => fb.includes(g));
  // 作品表が知らない作品同士は、3文字以上の非一般語を共有していれば同じとみなす。
  const tokens = a
    .split(/[\s　・/｜|【】「」『』()（）,、.。!！?？:：~〜\-–—+&"'’]+/)
    .filter((t) => t.length >= 3 && !GENERIC_WORDS.test(t));
  return tokens.some((t) => b.includes(t));
}

/**
 * 公式ページ（素HTML）から販売商品の価格帯・点数を抽出する。商品名は各サイトで書式が
 * バラバラで誤爆しやすいため、堅牢に取れる「価格の範囲＋出現点数」を返す（何が売られるかの
 * 規模と価格帯を示す）。SPA/文字コード非対応/価格が本文に無いページでは null。
 */
export function extractOfficialSale(html: string): { count: number; min: number; max: number } | null {
  const text = html.replace(/<[^>]+>/g, " ");
  const prices = [...text.matchAll(/([0-9][0-9,]{1,6})円/g)]
    .map((m) => Number(m[1].replace(/,/g, "")))
    .filter((n) => n >= 100 && n <= 500000);
  if (prices.length < 3) return null;
  return { count: prices.length, min: Math.min(...prices), max: Math.max(...prices) };
}

/** 価格帯を表示用に整形（例: "公式: 価格帯 ¥550〜¥5,280・約19点"） */
export function formatSale(s: { count: number; min: number; max: number }): string {
  const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;
  return `公式: 価格帯 ${yen(s.min)}〜${yen(s.max)}・約${s.count}点`;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

// 抽選/くじ判定に使う散文シグナル（本文の地の文に出る＝当該イベントの仕組み）。
// ※「一番くじ」は本文では“関連記事リンク”（他イベント見出し）として頻出し、当該イベントの
//   仕組みを表さない誤検出源なので**検出語に含めない**。真の一番くじは subGenre="くじ" と
//   ichiban_kuji ソース（構造化された各賞）で捕捉する。実測: 誤 hasLottery の主因が
//   本文埋め込みの関連「◯◯ 一番くじ …発売! 期間 :」リンクだった。
const LOTTERY_PROSE_RE = /抽選|抽籤|当選|当籤|ラストワン|ラスワン|ハズレ無|はずれ無/;
// 「抽選ではない/なし」等の否定文脈。抽選語が弱いシグナル（抽選/抽籤/当選/当籤）だけのときに
// これが本文にあれば、先着販売等を抽選と誤判定しないよう hasLottery を落とす。
const LOTTERY_NEG_RE = /抽選(?:では|じゃ)な|抽選(?:は)?(?:あり|行い|行なわ|おこな)?ませ|抽選なし|抽選制ではな|抽選ではございませ/;
// ブラインド/ランダム封入（買えるが中身が選べない＝キャラ次第で相場が付く）。抽選とは別軸。
const RANDOM_RE = /ランダム|トレーディング|ブラインド|ランダム封入|全\d+種.*(コンプ|ランダム)/;
// 数量限定・先着・受注など「入手性が低い」を示す語（抽選ではないが希少）。
const SCARCITY_RE = /数量限定|先着|限定生産|受注(生産|販売)?|完全受注|予約限定|会場限定|店舗限定/;

// せどらーが狙う注目賞品の名詞。長い複合語を先に並べ、短い語（タオル/カード/バッジ）が
// 複合語（マフラータオル/ポストカード/缶バッジ）に内包される場合は複合語を優先する。
const GOODS_NOUNS = [
  "マフラータオル", "フェイスタオル", "バスタオル", "タオル",
  "アクリルスタンド", "アクリルキーホルダー", "アクスタ",
  "トレーディングカード", "ブロマイド", "ポストカード", "ポスター",
  "ぬいぐるみ", "フィギュア", "ねんどろいど",
  "缶バッジ", "ピンバッジ", "バッジ",
  "ラバーストラップ", "アクリルチャーム", "チャーム", "キーホルダー",
  "クリアファイル", "ステッカー", "シール", "コースター",
  "タペストリー", "色紙", "マグカップ", "グラス",
  "ポーチ", "巾着", "トレカ", "カード",
];

export type CollabEnrichment = {
  hasLottery: boolean; // 真の抽選/くじ/ラストワン等（抽選タブで拾う）
  hasRandom: boolean; // ランダム/ブラインド封入（買えるが中身が選べない）
  hasScarcity: boolean; // 数量限定・受注など希少性がある
  highlights: string | null; // カード/詳細に出す注目賞品の要約
};

/** 本文テキストから抽選/ランダム/希少シグナルと注目グッズ名を抽出して要約する。
 *  ※ 表記は「裏取り済みの事実だけ約束」原則に従う。本文に抽選/ランダム等の“仕組み”が
 *   書かれている事実（＝検証可能）と、本文に登場するグッズ名（＝検証可能）は示すが、
 *   「そのグッズが抽選の賞品だ」という未確認の断定はしない（旧「抽選賞品：X」を廃止）。 */
export function analyzeCollab(bodyText: string, subGenre?: string | null): CollabEnrichment {
  // subGenre="くじ" は一覧の種別分類で確定した“くじイベント”＝抽選ありとして扱う。
  // それ以外は本文の散文シグナル（LOTTERY_PROSE_RE）で判定し、弱いシグナルのみで否定文脈が
  // あるなら抽選ではないとする。
  const isKuji = subGenre === "くじ";
  const proseLottery = LOTTERY_PROSE_RE.test(bodyText);
  const strongLottery = isKuji || /ラストワン|ラスワン|抽籤|当籤/.test(bodyText);
  const hasLottery = isKuji || (proseLottery && !(!strongLottery && LOTTERY_NEG_RE.test(bodyText)));
  const hasRandom = RANDOM_RE.test(bodyText);
  const hasScarcity = SCARCITY_RE.test(bodyText);

  // 本文に出現するグッズ名を、複合語優先で最大4件まで拾う。
  const nouns: string[] = [];
  for (const noun of GOODS_NOUNS) {
    if (!bodyText.includes(noun)) continue;
    // 既に採用済みの語が今の語を内包する（例: マフラータオル採用済 → タオルは省く）なら skip
    if (nouns.some((n) => n.includes(noun))) continue;
    nouns.push(noun);
    if (nouns.length >= 4) break;
  }

  if (!hasLottery && !hasRandom && !hasScarcity && nouns.length === 0) {
    return { hasLottery, hasRandom, hasScarcity, highlights: null };
  }

  // 仕組みの見出し（検証可能な事実のみ）。抽選>ランダム>数量限定の優先で1つ。
  const mechanism = hasLottery
    ? "抽選・くじあり"
    : hasRandom
      ? "ランダム(ブラインド)封入"
      : hasScarcity
        ? "数量限定・受注"
        : null;
  // グッズ名は「登場グッズ」＝本文に出てくる商品名（賞品とは断定しない中立表現）。
  const goods = nouns.length ? `登場グッズ: ${nouns.join(" / ")}` : null;
  const highlights = [mechanism, goods].filter(Boolean).join(" ｜ ") || null;
  return { hasLottery, hasRandom, hasScarcity, highlights };
}

// ── 公式ページからの商品名＋個別価格の抽出（サイト別パーサ） ──────────────────
// 公式サイトは各社バラバラなので、書式が安定しているドメインだけ専用パーサを用意し、
// 未対応ドメインは price 帯のみ（extractOfficialSale）にフォールバックする。

/** rakuspa/極楽湯系の公式ページ。各商品は「<商品名> 店頭 通販 単　品 N円(税込)」で並ぶ。 */
function parseRakuspaItems(html: string): { name: string; price: number }[] {
  const text = html.replace(/<[^>]+>/g, " ").replace(/[\s　]+/g, " ");
  const re = /([^0-9円]{4,60}?)\s*店頭\s*通販\s*単\s*品\s*([0-9,]+)円/g;
  const out: { name: string; price: number }[] = [];
  for (const m of text.matchAll(re)) {
    const price = Number(m[2].replace(/,/g, ""));
    if (!Number.isFinite(price) || price <= 0) continue;
    // 名前は前段の【サイズ/材質】や dimension 残渣が付くので、既知の賞品名詞から始まる位置に寄せる。
    let name = m[1].replace(/【[^】]*】/g, "").replace(/[（(][^）)]*[）)]/g, "");
    const noun = GOODS_NOUNS.find((n) => name.includes(n));
    if (noun) name = name.slice(name.indexOf(noun));
    name = name.replace(/^[\s　・\-—/,、。].*?(?=\S)/, "").trim();
    if (/ここに商品名|ここに材質/.test(name)) continue; // テンプレ雛形行を除外
    out.push({ name: name.slice(0, 30), price });
  }
  return out;
}

/** 対応ドメインなら公式ページから {商品名, 価格} を返す。未対応は null。 */
export function extractOfficialItems(
  url: string,
  html: string
): { name: string; price: number }[] | null {
  if (/rakuspa\.com|gokurakuyu|store-gk/i.test(url)) {
    const items = parseRakuspaItems(html);
    return items.length ? items : null;
  }
  return null;
}

/** 公式の商品を賞品カテゴリ（タオル/缶バッジ等）＋価格帯に正規化して要約。
 *  例: "公式販売: タオル¥1,430 / 缶バッジ¥550 / アクスタ¥880〜1,540 …" */
export function formatOfficialItems(items: { name: string; price: number }[]): string | null {
  const buckets = new Map<string, { min: number; max: number }>();
  for (const it of items) {
    const key = GOODS_NOUNS.find((n) => it.name.includes(n));
    if (!key) continue; // 賞品名詞に紐づかない行（雑多/雛形）は要約に載せない
    const b = buckets.get(key);
    if (b) { b.min = Math.min(b.min, it.price); b.max = Math.max(b.max, it.price); }
    else buckets.set(key, { min: it.price, max: it.price });
  }
  if (buckets.size === 0) return null;
  const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;
  const parts = [...buckets.entries()]
    .slice(0, 6)
    .map(([k, b]) => `${k}${b.min === b.max ? yen(b.min) : `${yen(b.min)}〜${yen(b.max)}`}`);
  return `公式販売: ${parts.join(" / ")}`;
}

// ── 開催店舗・地図（「どこへ行けば買えるか」） ────────────────────────────────
//
// コラボ/ポップアップ/カフェは、通販の商品と違って**行くべき場所**が本体。
// 監査(no_purchase_route)で「購入導線が1本も無い」102件のうち大半がこれだった。
// 楽天検索を出しても意味が無い（会場限定なので買えない）のに、会場名も地図も出していなかった。
//
// 収集元の記事は末尾に構造化テーブルを持っている:
//   <table class="cc-table">
//     <tr><th>開催場所</th><td>DECOTTO by animate cafe</td></tr>
//     <tr><th>開催場所</th><td>【東京/原宿】原宿店<br />【大阪/梅田】大阪梅田店…</td></tr>
//     <tr><th>アクセス・地図</th><td><a href="https://maps.app.goo.gl/…">Googleマップ</a>で見る</td></tr>
//   </table>
// ここは記事本文の散文ではなく**編集部が入れた項目**なので、推測なしにそのまま読める。
//
// ※ 郵便番号つきの「住所」は収集元にもGoogleマップのHTML（JS描画）にも無い。
//   持っていないものを書かない代わりに、**会場名と地図リンク**（＝場所を特定できる事実）を出す。

/** cc-table から <th>ラベル</th><td>…</td> の td 部分（生HTML）を取り出す。 */
function ccTableCell(html: string, label: string): string | null {
  // String.raw で組む。通常のテンプレートリテラルだと `\s` が JS のエスケープとして
  // 潰れて（"s" になって）**別物の正規表現が黙って出来上がる**。実際これで最初の実装は
  // 全482件から1件も取れず、エラーも出なかった（0件という結果だけが残る型）。
  const re = new RegExp(
    String.raw`<th[^>]*>\s*` + label + String.raw`\s*</th>\s*<td[^>]*>([\s\S]*?)</td>`,
    "i"
  );
  return html.match(re)?.[1] ?? null;
}

const decodeEnt = (s: string): string =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    // 数値エンティティ全般（WordPressは & を &#038; と書く。実測: 店名「cafe&#038;space」が
    // stores JSON に生のまま入り本番カードに露出した）
    .replace(/&#x([0-9a-fA-F]{1,6});/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d{1,7});/g, (_, n) => String.fromCodePoint(Number(n)));

/** 「アクセス・地図」の地図URL（Googleマップ）。無ければ null。 */
export function extractMapUrl(html: string): string | null {
  const cell = ccTableCell(html, "アクセス・地図");
  if (!cell) return null;
  const href = cell.match(/href="(https?:\/\/[^"]+)"/)?.[1];
  if (!href) return null;
  // href属性の & は &amp; でエンコードされている。生のまま保存すると ?api=1&amp;query=… の
  // クエリ名が壊れ、地図検索が効かないリンクになる（実測 #117027）。
  return /(?:maps\.app\.goo\.gl|google\.[a-z.]+\/maps|goo\.gl\/maps)/.test(href) ? decodeEnt(href) : null;
}

/** 「開催場所」の会場名。<br> 区切りの複数店舗にも対応する。取れなければ空配列。 */
export function extractVenues(html: string): string[] {
  const cell = ccTableCell(html, "開催場所");
  if (!cell) return [];
  return cell
    .split(/<br\s*\/?>/i)
    .map((s) => decodeEnt(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 2 && s.length <= 80);
}

/**
 * 会場名の先頭 `【東京/原宿】` から都道府県を読む。**書いてある時だけ**返す
 * （店名から所在地を推測しない。「新宿店」が新宿にあるとは限らないため）。
 */
export function venuePrefecture(name: string): string | null {
  return name.match(/^【\s*([^/／\]】]+)\s*[/／]/)?.[1]?.trim() ?? null;
}

/** 開催店舗を stores 列（JSON）の形に整える。地図URLは会場が1つのときだけ紐づける
 *  （複数店舗のとき記事の地図リンクは1つしか無く、どの店のものか特定できないため）。 */
export function formatVenueStores(venues: string[], mapUrl: string | null): string | null {
  if (!venues.length) return null;
  const single = venues.length === 1;
  return JSON.stringify(
    venues.map((name) => ({
      name,
      url: single ? mapUrl : null,
      form: venuePrefecture(name),
      when: null,
      note: null,
    }))
  );
}
