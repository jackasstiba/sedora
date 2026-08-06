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

// SNS・URL短縮・アフィリエイト転送は「何が売られるか」の一次情報ではないので公式候補から除外する。
// t.co 等の短縮リンクや valuecommerce 等の転送は、飛んだ先が販売ページでも中間URLが露出し、
// また転送切れ・無関係先の危険があるため候補にしない（＝販売内容ページとして提示しない）。
const SOCIAL_RE =
  /youtube\.com|youtu\.be|twitter\.com|x\.com|facebook\.com|instagram\.com|line\.me|tiktok\.com|pinterest\.|t\.co\/|bit\.ly|tinyurl|ow\.ly|goo\.gl|lnky|linksynergy|valuecommerce|a8\.net|\.a8\.|accesstrade|felmat|dpbolvw|anrdoezrs|jdoqocy|tkqlhce|hb\.afl\.rakuten|a\.r10\.to|moshimo|af\.moshimo/i;

/**
 * 記事本文から一次情報（公式キャンペーン/公式ストア）候補URLを1つ選ぶ。
 * collabo-cafe 自身とSNSを除外し、ルートだけのドメインより「具体的なパスを持つページ」や
 * store/shop/goods 系を優先する（例: rakuspa.com/hololive_yumeguritabi/ を選ぶ）。
 */
export function extractOfficialUrl(html: string): string | null {
  const region = articleBodyHtml(html) || html;
  const urls = [...region.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
  const cand = urls.filter((u) => !u.includes("collabo-cafe.com") && !SOCIAL_RE.test(u));
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
  return score(best) > 0 ? best : null;
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
