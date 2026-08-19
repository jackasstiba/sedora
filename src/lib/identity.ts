/**
 * 「そのページに、その商品が載っているか」の判定。**リンクを約束にする前の裏取り**に使う。
 *
 * ここを1か所にしてある理由: 同じ判定を `scripts/auditFacts.ts`（出した後で検査する側）と
 * `src/scrapers/cardChusen.ts`（出す前に選ぶ側）の両方が使う。別実装にすると、
 * **検査が通らないURLを取り込み側が選び続ける**（＝毎回同じ指摘が出て、直しても再発する）。
 * [[UIラベルは裏取り済みのみ約束]] と同じ考え方で、**取り込む条件と検査する条件を同じ物差しにする**。
 */
import { normalizeForSearch } from "./itemFilter";
import { franchiseAliases } from "./franchise";

/** 商品名に頻出する一般語。識別語から外さないと「フィギュア」だけで一致してしまう。 */
const GENERIC =
  /^(フィギュア|ぬいぐるみ|プラモデル|カードゲーム|ブースターパック|拡張パック|完成品|限定|特典|予約|発売|再販|セット|ver|box|新作|グッズ|コラボ|オンライン|一番くじ|抽選|販売|アクリルスタンド|キーホルダー|ポップアップストア)$/i;

/** 商品名から「その商品を名指しする語」を取り出す（最大6語・正規化済み）。 */
export function identityTokens(title: string): string[] {
  return title
    .split(/[\s　【】『』「」（）()[\]・/／\-–—~〜,、。!！?？:：＆&×✕]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !GENERIC.test(t))
    .map(normalizeForSearch)
    .filter((t, i, a) => a.indexOf(t) === i)
    .slice(0, 6);
}

/**
 * ページ本文にその商品が出てくるか。`text` は **normalizeForSearch 済み**を渡すこと。
 *
 * 作品名は日英・カナで表記が割れる（こちらが「ONE PIECE カードゲーム」、一次情報は
 * 「ワンピースカードゲーム」＝正しいリンクなのに外れる）ので、作品エイリアス表も通す。
 */
export function pageShowsProduct(normalizedText: string, title: string): boolean {
  const toks = identityTokens(title);
  if (toks.some((k) => normalizedText.includes(k))) return true;
  if (franchiseAliases(title).map(normalizeForSearch).some((a) => normalizedText.includes(a))) return true;
  // 空白の入り方は収集元と一次情報で割れる（実測 #91634: こちらが「ジェラートピケ」、
  // Amazon の商品名は「ジェラート ピケ」＝**同じ商品なのに「載っていない」になる**）。
  // 空白を落とした形でももう一度当てる。**外れの判定は緩い方に倒す**
  //（載っていないと言い切る側の誤りは、こちらが一次情報を嘘だと言うことになるため）。
  const squeeze = (x: string) => x.replace(/[\s　]+/g, "");
  const flat = squeeze(normalizedText);
  return toks.some((k) => flat.includes(squeeze(k)));
}

/**
 * 一致した識別語の数。**どれだけ強く「その商品のページ」と言えるか**の目安。
 *
 * 2026-08-19 実測: 「ポケモンカード デッキビルドBOX 黒炎の支配者」の候補として、
 * `geo-online.co.jp/news/626` は「ポケモンカード」の1語しか当たらない（＝ポケカの告知では
 * あるが、この弾のページとは限らない）。**当たった/当たらないの2値で選ぶと、
 * 弱い一致でも1位になる**ので、選ぶときは数の多い方を採る。
 */
export function identityMatchCount(normalizedText: string, title: string): number {
  const squeeze = (x: string) => x.replace(/[\s　]+/g, "");
  const flat = squeeze(normalizedText);
  const toks = identityTokens(title);
  let n = toks.filter((k) => normalizedText.includes(k) || flat.includes(squeeze(k))).length;
  if (n === 0 && pageShowsProduct(normalizedText, title)) n = 1; // 作品エイリアスだけ当たった場合
  return n;
}

/**
 * 識別語が1つしか無い商品名は、一致しなくても「載っていない」と言い切れない
 * （検査側が `toks.length >= 2` を条件にしているのと同じ理由）。
 */
export function canJudgeIdentity(title: string): boolean {
  return identityTokens(title).length >= 2;
}
