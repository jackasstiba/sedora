// Xミラー系(channeltono/rarecheck)のタイトルは実況コメント込みの自由文で長い。
// 一覧カードでの可読性を上げるため、表示用に商品名へ寄せて整形する。
// ※ 非破壊: DBの生titleは検索・詳細ページ用にそのまま残し、これは「一覧カードの表示専用」。
//   誤って商品名を削らないよう、剥がすのは実況コメント語を含む部分だけに限定し、
//   商品タグ(【特典】等)や『』内は決して削らない。結果が短くなりすぎたら生titleに戻す。

const CLEANABLE_SOURCES = new Set(["channeltono", "rarecheck"]);

// snkrdunk（スニーカーダンク）は全商品タイトル末尾に「｜抽選/販売/定価情報」という
// 内部向けの定型ラベルが付く。ユーザーには無意味なノイズなので、表示時に必ず剥がす。
// （DBの生titleは isLotteryItem 等の判定に使うので温存し、これは表示専用。）
const SOURCE_LABEL_TAIL = /\s*[｜|]\s*(?:抽選|販売|定価|情報)[^｜|]*$/;
// 先頭の「最新リーク｜」「リーク｜」等のラベル（snkrdunkのリーク記事）。
const SOURCE_LABEL_HEAD = /^(?:最新)?リーク\s*[｜|]\s*/;

/** 情報元由来の定型ラベル（末尾「｜抽選/販売/定価情報」・先頭「最新リーク｜」等）を表示用に除去する。全ソース対象。 */
export function stripSourceLabel(title: string): string {
  const t = title.replace(SOURCE_LABEL_TAIL, "").replace(SOURCE_LABEL_HEAD, "").trim();
  return t.length >= 4 ? t : title.trim();
}

/**
 * subGenre（種別）バッジの表示値。収集元の痕跡（X巡回ハンドル @xxx）は非公開方針のため出さない。
 * 書き込み側(xWatch)は修正済みだが、既存DBに残る @handle の subGenre を表示層でも握りつぶす。
 */
export function displaySubGenre(subGenre: string | null | undefined): string | null {
  if (!subGenre) return null;
  const t = subGenre.trim();
  if (!t || t.startsWith("@")) return null;
  return t;
}

// 実況コメント特有の語。これを含む先頭/末尾セグメントだけを剥がす。
// ※「特典/限定販売/数量限定」は商品タグ(【特典】等)の一部なのでコメント語に含めない。
const COMMENTARY =
  /(予約|販売|再開|開始|完売|まだあり|まだいけ|ご注意|注意を|きたー|来たー|復活|オフ|％オフ|値引|大幅|残り|即完売|豪華|人気|お早め|お早目|きました|いけます|即完|抽選受付|受付開始|更新|動画|いいね)/;

// 商品タグ（ここから商品名が始まることが多い）。
const PRODUCT_TAG = /【(?:特典|限定販売|あみあみ限定特典|予約特典|数量限定|再販)/;

// 先頭の日付・締切・時刻告知（「7月28日10時より」「本日7月30日まで！」「5/5 13時より」
// 「8月5日まで！」等）。日付・締切は決して商品名ではないので安全に剥がせる。
// 日付範囲（「7月30日より8月4日まで！」）は stripLeading のループで1節ずつ順に除去される。
// 日付部の直後に「月」「日」が続く場合は連続する月・日の列挙（「10月11月12月出荷分」等の
// 出荷月スペック）なので、途中で切らないよう負の先読み (?!\s*[月日]) でマッチさせない。
// 各桁グループ直後の (?!\d) は最大一致を強制し、連続月（「10月11月12月」）で先読みが
// 失敗したとき桁を縮めて途中マッチする（「10月1」→「2月出荷分」化）バックトラックを防ぐ。
const LEADING_DATE =
  /^\s*(?:本日|明日|もうすぐ|まもなく)?\s*\d{1,2}(?!\d)\s*[月\/]\s*\d{1,2}(?!\d)\s*[日]?(?!\s*[月日])\s*(?:\([月火水木金土日]\))?\s*(?:\d{1,2}\s*時(?:\d{1,2}\s*分)?)?\s*(?:より|から|まで(?:に)?)?\s*[！!、]?\s*/;

// 「まで/締切/完売」や日付を含む告知節（商品名ではない）。先頭の店舗＋締切告知の判定に使う。
const NOTICE_SEG = /(まで|締切|完売|\d{1,2}\s*月\s*\d{1,2}\s*日|\d{1,2}\/\d{1,2})/;

// 先頭の店舗名プレフィックス（「プレバンで」「あみあみで」等）。この直後から商品名が始まる。
const LEADING_STORE =
  /^(?:プレバン|プレミアムバンダイ|あみあみ|駿河屋|楽天|ヨドバシ|Amazon|アマゾン|ミニストップ(?:オンライン)?|セブン(?:ネット)?|ローソン|イオン|タカラトミーモール)(?:で|にて|は|より|なら)/;

// 末尾の「〜が抽選受付開始！」等のアクション告知（商品名ではない）。連結助詞＋動作句＋記号。
const TRAILING_ACTION =
  /\s*(?:が|も|を|は|、|。)?\s*(?:(?:抽選)?受付開始|予約(?:受付)?開始|販売(?:開始|再開)|受注(?:生産)?(?:開始)?|再販(?:開始|決定)?|再入荷|復活)(?:へ|中|です)?[！!。\s]*$/;

/** 商品名らしさ（英数・4字以上のカタカナ・商品タグを含む＝コメントとして剥がしてはいけない）。 */
function looksProduct(s: string): boolean {
  return /[【『「]/.test(s) || /[A-Za-z0-9]/.test(s) || /[ァ-ヶ]{4,}/.test(s);
}

/** 『...』または「...」で囲まれた最初の商品名（長さ4以上）を取り出す */
function firstBracketed(title: string): string | null {
  const m = title.match(/[『「]([^』」]{4,})[』」]/);
  return m ? m[1].trim() : null;
}

/** 先頭の全角スペース区切りの告知節（「他店即完売の人気　」「◯◯は7月31日まで　」等）を剥がす。
 *  コメント語 or 締切・日付を含み、商品らしさ（英数・長いカタカナ・商品タグ）が無い節だけ。 */
function stripLeadingSpaceSegs(title: string): string {
  let s = title;
  for (let i = 0; i < 4; i++) {
    const idx = s.indexOf("　");
    if (idx <= 0) break;
    const head = s.slice(0, idx);
    const rest = s.slice(idx + 1).trim();
    if (rest.length < 6 || looksProduct(head)) break;
    if (COMMENTARY.test(head) || NOTICE_SEG.test(head)) s = rest;
    else break;
  }
  return s;
}

/** 末尾のアクション告知（「〜が抽選受付開始！」）と、！で終わるコメント節を剥がす。 */
function stripTrailingActions(title: string): string {
  let s = title.trim();
  for (let i = 0; i < 4; i++) {
    const before = s;
    // (a) 「〜が抽選受付開始！」等の定型アクション句
    const a = s.replace(TRAILING_ACTION, "").trim();
    if (a.length >= 6) s = a;
    // (b) 末尾の！で終わるコメント節（コメント語を含み、商品らしさ無し）
    const m = s.match(/^(.*?)([^！!。]{2,30}[！!])\s*$/);
    if (m && COMMENTARY.test(m[2]) && !looksProduct(m[2]) && m[1].trim().length >= 6) {
      s = m[1].trim();
    }
    if (s === before) break;
  }
  return s;
}

/** 先頭側の告知を繰り返し剥がす。1周ごとに
 *  (a) 日付・締切・時刻告知（LEADING_DATE。商品名ではないので安全）と
 *  (b) 実況コメント節（！。区切りでコメント語を含む節）を順に試す。
 *  日付とコメントが交互に来ても（「7月30日より8月4日まで！あみあみで予約開始！商品名」等）
 *  ループで剥がしきれる。商品タグ【…】や『』を含む節は商品名の一部なので剥がさない（安全側）。 */
function stripLeadingCommentary(title: string): string {
  let t = title.trim();
  for (let i = 0; i < 8; i++) {
    const before = t;
    // (a) 先頭の日付・締切・時刻告知を除去
    t = t.replace(LEADING_DATE, "").trim();
    // (b) 先頭の実況コメント節（！。で区切られコメント語を含む）を除去
    const m = t.match(/^([^！!。]{2,40}[！!。])\s*(.+)$/);
    if (m && COMMENTARY.test(m[1]) && !/[【『「]/.test(m[1]) && m[2].trim().length >= 6) {
      t = m[2].trim();
    }
    if (t === before) break;
  }
  return t;
}

/** 末尾側の実況コメント（全角スペース以降がコメント語主体）を剥がす */
function stripTrailingCommentary(title: string): string {
  const parts = title.split("　");
  while (parts.length > 1) {
    const last = parts[parts.length - 1];
    const looksProduct = /[A-Za-z0-9]/.test(last) || /[ァ-ヶ]{4,}/.test(last);
    if (COMMENTARY.test(last) && !looksProduct) {
      parts.pop();
    } else {
      break;
    }
  }
  return parts.join("　");
}

/** 一覧カード表示用にタイトルを整形（非破壊・失敗時は原文）。 */
export function cleanListTitle(source: string, title: string): string {
  // まず全ソース共通で情報元由来の定型ラベル（snkrdunkの「｜…」）を剥がす。
  const base = stripSourceLabel(title);
  if (!CLEANABLE_SOURCES.has(source)) return base;
  const raw = base.trim();

  // 1) 『』「」があれば最も信頼できる商品名としてそれを採用（主に rarecheck）。
  const bracketed = firstBracketed(raw);
  if (bracketed) return bracketed;

  // 2) 【特典】等の商品タグがあり、その手前が実況コメントなら、タグから商品名が始まるとみなす。
  const tagIdx = raw.search(PRODUCT_TAG);
  if (tagIdx > 0 && COMMENTARY.test(raw.slice(0, tagIdx))) {
    const fromTag = stripTrailingCommentary(raw.slice(tagIdx).trim());
    if (fromTag.length >= 6) return fromTag;
  }

  // 3) 先頭の告知を繰り返し剥がす：全角スペース区切りの締切/コメント節 → 日付・実況コメント節
  //    → 店舗プレフィックス。カタカナ店舗名（ミニストップ等）＋締切が連なるケースも周回で剥がす。
  let t = raw;
  for (let i = 0; i < 4; i++) {
    const before = t;
    t = stripLeadingSpaceSegs(t);
    t = stripLeadingCommentary(t);
    const noStore = t.replace(LEADING_STORE, "").trim();
    if (noStore.length >= 6 && looksProduct(noStore)) t = noStore;
    if (t === before) break;
  }

  // 4) 末尾の実況コメント（全角スペース以降）と、アクション告知（「〜が抽選受付開始！」）を剥がす。
  t = stripTrailingCommentary(t);
  t = stripTrailingActions(t);
  t = t.trim();

  // 5) 削りすぎ・空は原文に戻す（安全側）。
  return t.length >= 6 ? t : raw;
}
