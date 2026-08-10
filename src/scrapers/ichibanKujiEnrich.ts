// 一番くじ商品ページ（1kuji.com/products/SLUG）の本文から、せどらーが最も欲しい
// 「各等賞一覧（A賞〜ラストワン賞）」を抽出する純関数。
//
// 背景: 一覧スクレイパー(ichibanKuji.ts)は商品名・発売日しか取れず、その中の
// “どんな賞品が当たるか”＝A賞のフィギュアやラストワン賞（＝二次相場が最も高い核）に
// 届いていなかった。詳細ページは <section class="listCol"> に各賞が構造化されている:
//   <div class="itemColList">
//     <h4 class="name sp">A賞 別班饅頭クッション</h4> ...（pc用にもう1つ同名）
//     <img ... src="https://assets.1kuji.com/.../xxx.webp">
// これを賞ラベル＋賞品名（＋画像）に構造化する。

export type KujiPrize = { label: string; name: string; image: string | null };

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();
}

/** 「各等賞一覧」セクション(listCol)だけ切り出す。無ければ空文字。 */
function listSection(html: string): string {
  const s = html.indexOf('class="listCol"');
  if (s < 0) return "";
  const e = html.indexOf("</section>", s);
  return e > s ? html.slice(s, e) : html.slice(s);
}

/** 「A賞 別班饅頭クッション」→ {label:"A賞", name:"別班饅頭クッション"} に分割。 */
function splitPrize(raw: string): { label: string; name: string } {
  const m = raw.match(/^(.+?賞)\s+(.+)$/);
  if (m) return { label: m[1].trim(), name: m[2].trim() };
  return { label: raw.trim(), name: "" };
}

/**
 * 詳細ページHTMLから各等賞のラインナップを抽出する。
 * itemColList ブロック単位で賞名(sp表記=pcと重複するので sp のみ採用)と代表画像を取る。
 * listCol が無い/賞が取れないページでは空配列（＝深掘り失敗、呼び出し側は既存情報を活かす）。
 */
export function extractKujiPrizes(html: string): KujiPrize[] {
  const sec = listSection(html);
  if (!sec) return [];
  const blocks = sec.split('class="itemColList"').slice(1);
  const out: KujiPrize[] = [];
  const seen = new Set<string>();
  for (const b of blocks) {
    const rawName = b.match(/<h4 class="name sp">([^<]+)<\/h4>/)?.[1];
    if (!rawName) continue;
    const { label, name } = splitPrize(decodeEntities(rawName));
    if (!label || seen.has(label)) continue;
    seen.add(label);
    const img =
      b.match(/<img[^>]+src="(https:\/\/assets\.1kuji\.com\/[^"]+)"/)?.[1] ??
      b.match(/data-src="(https:\/\/assets\.1kuji\.com\/[^"]+)"/)?.[1] ??
      null;
    out.push({ label, name, image: img });
  }
  return out;
}

/**
 * 抽出した各賞を highlights 用の1行要約にする（カード/詳細/SEOで共有）。
 * せどり視点では A賞 と ラストワン賞 が相場の核なので順序はそのまま全賞を「／」区切りで
 * 並べ、末尾に「全N種」を付ける。詳細ページ側はこの「／」区切りをリスト表示に展開する。
 * 例: "各賞ラインナップ：A賞 別班饅頭クッション ／ … ／ ラストワン賞 …（全10種）"
 */
export function formatKujiHighlights(prizes: KujiPrize[]): string | null {
  if (!prizes.length) return null;
  const parts = prizes.map((p) => (p.name ? `${p.label} ${p.name}` : p.label));
  return `各賞ラインナップ：${parts.join(" ／ ")}（全${prizes.length}種）`;
}

// ── 商品概要（1回いくら／どこで引けるか） ─────────────────────────────────
// 詳細ページの <div class="detail glBox"><ul> に、せどりの採算計算に必須の2つが入っている:
//   <li>■メーカー希望小売価格：1回850円(税10％込)</li>
//   <li>■取扱店：ファミリーマート、書店、ホビーショップ、一番くじ公式ショップなど</li>
// これまでどちらも取っておらず、一番くじは **1回いくらかも、どこで引けるかも分からない**まま
// 賞品ラインナップだけが並んでいた（ロット単価が出せない＝期待値を計算できない）。
// オンラインくじ(raffle_kuji)は「1回 770円（税込）」を出せていたので、同じ土俵に揃える。

function detailListItems(html: string): string[] {
  const s = html.indexOf('class="detail glBox"');
  if (s < 0) return [];
  const e = html.indexOf("</div>", s);
  const sec = e > s ? html.slice(s, e) : html.slice(s, s + 4000);
  return [...sec.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) =>
    decodeEntities(m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " "))
  );
}

/** 「■メーカー希望小売価格：1回850円(税10％込)」→ "1回 850円（税込）"。読めなければ null。 */
export function extractKujiFee(html: string): string | null {
  for (const li of detailListItems(html)) {
    if (!/希望小売価格|価格/.test(li)) continue;
    const m = li.match(/1\s*回\s*([0-9,]+)\s*円/);
    if (m) return `1回 ${m[1]}円（税込）`;
  }
  return null;
}

/** 「■取扱店：ファミリーマート、書店、…」→ "ファミリーマート、書店、…"。読めなければ null。 */
export function extractKujiStores(html: string): string | null {
  for (const li of detailListItems(html)) {
    const m = li.match(/■?\s*取扱店\s*[:：]\s*(.+)$/);
    if (!m) continue;
    const v = m[1].trim();
    if (v) return v;
  }
  return null;
}
