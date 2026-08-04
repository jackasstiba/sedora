// 抽選アグリゲーター（入荷Now / 転売クエスト）共通のヘルパー。
//
// 【方針・2026-08-04 本人確定】これらの競合アグリの抽選情報は "全部" 取り込むが、
// フロントには収集元（サイト名・その記事へのリンク）を一切出さない＝「情報源にしていない体裁」。
// 代わりに記事から辿れる一次情報（公式・小売の抽選ページ）や、商品名での楽天検索を購入導線にする。
// アフィリエイト/トラッキングのクエリは必ず除去する（売上流出＋情報源露見の防止）。

/** タグを落として可視テキストにする */
export function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#0?38;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// 情報源（アグリ本体）・SNS・アプリストア等、購入導線として使えないリンク。
export const NOISE_LINK =
  /nyuka-now\.com|nyukanow\.page\.link|tenbaiquest\.com|apple\.co|apps\.apple\.com|play\.google\.com|twitter\.com|x\.com|facebook\.com|line\.me|b\.hatena|getpocket\.com|kaereba\.com|policies\.google|accesstrade\.net|a8\.net|aucfree\.com|auctions\.yahoo\.co\.jp\/closedsearch/i;

// アフィリエイト/トラッキングのクエリ。特に Amazon アソシエイトタグ（tag=... 等）を必ず落とす。
const TRACK_PARAM =
  /^(tag|aod|ref|ref_|linkcode|creative|creativeasin|camp|ascsubtag|_encoding|th|psc|smid|utm_[a-z]+|yclid|gclid|fbclid|dib|dib_tag|content-id|qid|sr|keywords|m|rk|__mk_ja_jp)$/i;

/** 外部URLからアフィリ/トラッキングを除去し、Amazon は /dp/{ASIN} の素URLに正規化する。 */
export function cleanStoreUrl(raw: string): string {
  const href = raw.replace(/&#0?38;/g, "&").replace(/&amp;/g, "&");
  try {
    const u = new URL(href);
    if (/(^|\.)amazon\.co\.jp$/i.test(u.hostname)) {
      const asin = u.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i);
      if (asin) return `https://www.amazon.co.jp/dp/${asin[1].toUpperCase()}`;
    }
    for (const k of [...u.searchParams.keys()]) {
      if (TRACK_PARAM.test(k)) u.searchParams.delete(k);
    }
    return u.toString();
  } catch {
    return href;
  }
}

/**
 * アグリゲーターの商品名/タイトルからハツコレのトップレベルジャンルを推定する。
 * 家電・ゲーム機や酒・ウイスキー、ソフビ/アートトイなど、既存の classifyGenre（util.ts）が
 * カバーしない抽選特有のカテゴリを含めて振り分ける。判定順は「取り違えやすい順」に固定。
 */
export function classifyAggregatorGenre(text: string): string {
  const norm = text.normalize("NFKC");
  const t = norm.toLowerCase();

  // 酒（ウイスキー/ワイン/日本酒/焼酎）＝転売人気だが既存分類に無い。最優先で拾う。
  if (
    /ウイスキー|ウィスキー|whisky|whiskey|山崎|白州|響|イチローズ|ニッカ|竹鶴|余市|宮城峡|マッカラン|シングルモルト|バーボン|ワイン|wine|シャンパン|日本酒|焼酎|梅酒|テキーラ|ブランデー|コニャック/i.test(
      norm
    )
  ) {
    return "酒・ウイスキー";
  }

  // ソフビ/アートトイ（LABUBU/POP MART/BE@RBRICK/メディコム/村上隆 等）＝フィギュア判定より先に。
  if (
    /labubu|ラブブ|pop\s*mart|ポップマート|be@rbrick|ベアブリック|bearbrick|ソフビ|sofvi|メディコム|medicom|\bvag\b|村上隆|kaws|カウズ|molly|モリー|dimoo|skullpanda|アートトイ|ソフトビニール/i.test(
      t
    )
  ) {
    return "ソフビ・アートトイ";
  }

  // 家電・ゲーム機（ハード＝Switch2/PS5/GPU/カメラ等）
  if (
    /switch|nintendo\s*switch|スイッチ|プレイステーション|playstation|\bps5\b|\bps4\b|プレステ|xbox|geforce|\brtx\b|\bradeon\b|グラフィック(?:ボード|ス)|グラボ|\bgpu\b|steam\s*deck|rog\s*ally|meta\s*quest|quest\s*3|\bvr\b|カメラ|instax|チェキ|一眼|レンズ|ricoh\s*gr|\bgr\s*(?:iii|iv|3|4)\b|ライカ|leica|fujifilm|富士フイルム|x100|nikon\s*z|eos\s*r|家電/i.test(
      t
    )
  ) {
    return "家電・ゲーム機";
  }

  // プラモ/ガンプラ
  if (
    /ガンプラ|プラモ|プラモデル|\bmg\b|\bhg\b|\brg\b|\bpg\b|\bhguc\b|\bmgsd\b|1\/144|1\/100|1\/60|アーセナルベース|解体匠機|30mm|30\s*minutes/i.test(
      t
    )
  ) {
    return "プラモ";
  }

  // トレカ（"カード"単体では判定しない＝楽天カード等の誤検出回避）
  if (
    /トレカ|トレーディングカード|カードゲーム|ポケカ|ポケモンカード|ワンピースカード|ワンピカード|遊戯王|デュエル?・?マスターズ|デュエマ|\bmtg\b|マジック・ザ・ギャザリング|ヴァイスシュヴァルツ|拡張パック|スターターデッキ|ブースターパック|ロルカナ|lorcana|カードダス|フュージョンワールド|ユニオンアリーナ|union\s*arena/i.test(
      norm
    )
  ) {
    return "トレカ";
  }

  // スニーカー
  if (
    /スニーカー|sneaker|nike|ナイキ|adidas|アディダス|jordan|ジョーダン|dunk|ダンク|new\s*balance|ニューバランス|asics|アシックス|エアフォース|エアマックス|vans|バンズ|converse/i.test(
      t
    )
  ) {
    return "スニーカー";
  }

  // フィギュア（聖闘士聖衣神話・超合金・プライズ等を含む）
  if (
    /フィギュア|フィギュアーツ|figuarts|ねんどろ|プライズ|スケール|scale|超合金|聖闘士|monsterarts|ぬいぐるみ|プラモ以外の完成品/i.test(
      norm
    )
  ) {
    return "フィギュア";
  }

  // 映像・音楽
  if (/ブルーレイ|blu-ray|dvd|4k\s*uhd|steelbook|スチールブック|レコード|アナログ盤|cd\b|アルバム/i.test(t)) {
    return "映像・音楽";
  }

  return "その他";
}
