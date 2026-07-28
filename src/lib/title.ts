// Xミラー系(channeltono/rarecheck)のタイトルは実況コメント込みの自由文で長い。
// 一覧カードでの可読性を上げるため、表示用に商品名へ寄せて整形する。
// ※ 非破壊: DBの生titleは検索・詳細ページ用にそのまま残し、これは「一覧カードの表示専用」。
//   誤って商品名を削らないよう、剥がすのは実況コメント語を含む部分だけに限定し、
//   商品タグ(【特典】等)や『』内は決して削らない。結果が短くなりすぎたら生titleに戻す。

const CLEANABLE_SOURCES = new Set(["channeltono", "rarecheck"]);

// 実況コメント特有の語。これを含む先頭/末尾セグメントだけを剥がす。
// ※「特典/限定販売/数量限定」は商品タグ(【特典】等)の一部なのでコメント語に含めない。
const COMMENTARY =
  /(予約|販売|再開|開始|完売|まだあり|まだいけ|ご注意|注意を|きたー|来たー|復活|オフ|％オフ|値引|大幅|残り|即完売|豪華|人気|お早め|お早目|きました|いけます|即完|抽選受付|受付開始|更新|動画|いいね)/;

// 商品タグ（ここから商品名が始まることが多い）。
const PRODUCT_TAG = /【(?:特典|限定販売|あみあみ限定特典|予約特典|数量限定|再販)/;

// 先頭の日時・店舗告知（「7月28日10時より楽天ブックスで」「5/5 13時より」等）。
const LEADING_DATE =
  /^\s*\d{1,2}\s*[月\/]\s*\d{1,2}\s*[日]?\s*(?:\([月火水木金土日]\))?\s*(?:\d{1,2}時)?\s*(?:より|から)?\s*/;

/** 『...』または「...」で囲まれた最初の商品名（長さ4以上）を取り出す */
function firstBracketed(title: string): string | null {
  const m = title.match(/[『「]([^』」]{4,})[』」]/);
  return m ? m[1].trim() : null;
}

/** 先頭側の実況コメント（！。で区切られ、コメント語を含む節）を繰り返し剥がす。
 *  商品タグ【…】や『』を含む節は商品名の一部なので剥がさない（安全側）。 */
function stripLeadingCommentary(title: string): string {
  let t = title;
  for (let i = 0; i < 5; i++) {
    const m = t.match(/^([^！!。]{2,40}[！!。])\s*(.+)$/);
    if (!m) break;
    const head = m[1];
    const rest = m[2].trim();
    if (COMMENTARY.test(head) && !/[【『「]/.test(head) && rest.length >= 6) {
      t = rest;
    } else {
      break;
    }
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
  if (!CLEANABLE_SOURCES.has(source)) return title;
  const raw = title.trim();

  // 1) 『』「」があれば最も信頼できる商品名としてそれを採用（主に rarecheck）。
  const bracketed = firstBracketed(raw);
  if (bracketed) return bracketed;

  // 2) 【特典】等の商品タグがあり、その手前が実況コメントなら、タグから商品名が始まるとみなす。
  const tagIdx = raw.search(PRODUCT_TAG);
  if (tagIdx > 0 && COMMENTARY.test(raw.slice(0, tagIdx))) {
    const fromTag = stripTrailingCommentary(raw.slice(tagIdx).trim());
    if (fromTag.length >= 6) return fromTag;
  }

  // 3) 先頭の日時・店舗告知を除去。
  let t = raw.replace(LEADING_DATE, "").trim();

  // 4) 先頭・末尾の実況コメントを（コメント語を含む節だけ）剥がす。
  t = stripLeadingCommentary(t);
  t = stripTrailingCommentary(t);
  t = t.trim();

  // 5) 削りすぎ・空は原文に戻す（安全側）。
  return t.length >= 6 ? t : raw;
}
