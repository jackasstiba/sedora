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
  /^(tag|aod|ref|ref_|linkcode|creative|creativeasin|camp|ascsubtag|_encoding|th|psc|smid|utm_[a-z]+|yclid|gclid|fbclid|dib|dib_tag|content-id|qid|sr|keywords|m|rk|__mk_ja_jp|af_id|ch|ch_id)$/i;

// アフィリエイトの「リダイレクトラッパー」ホスト。クエリに本来の行き先URLを持ち、
// そのまま載せると収集元のアフィリID（af_id=nnow-001 等）ごとユーザーに配ってしまう。
// クエリ除去では消えない（ホスト自体がアフィリ）ので、行き先URLを取り出して置き換える。
// 実測: 入荷Now の DMM リンクが al.dmm.com/?lurl=<本来のURL>&af_id=nnow-001 型だった。
export const AFFILIATE_REDIRECT = /(^|\.)(al\.dmm\.com|px\.a8\.net|h\.accesstrade\.net|ck\.jp\.ap\.valuecommerce\.com|hb\.afl\.rakuten\.co\.jp)$/i;
const REDIRECT_URL_PARAM = /^(lurl|url|pc|m|vc_url|rd)$/i;

/** 外部URLからアフィリ/トラッキングを除去し、Amazon は /dp/{ASIN} の素URLに正規化する。 */
export function cleanStoreUrl(raw: string): string {
  let href = raw.replace(/&#0?38;/g, "&").replace(/&amp;/g, "&");
  // collabo-cafe は既にクエリを持つURLへも「?utm_source=…」を盲目的に連結するため、
  // 「…?id=115888&?utm_source=…」のように ? が2つある不正URLになる。URLとして
  // パースすると2つ目以降が**値の一部**として温存される（%3Futm_source%3D… に化けて
  // 収集元名が残った実測 #55731）。2つ目の ? から先はトラッキングなので落とす。
  const q1 = href.indexOf("?");
  if (q1 >= 0) {
    const q2 = href.indexOf("?", q1 + 1);
    if (q2 >= 0) href = href.slice(0, q2).replace(/[&?]$/, "");
  }
  // ? を介さずパス末尾に直接連結された変種（実測 #10562: …/utm_source=collabo_cafe…）。
  href = href.replace(/\/utm_[a-z]+=[^/]*$/i, "/");
  try {
    const u = new URL(href);
    // アフィリラッパーは行き先URLを取り出して、それをあらためて掃除する（1段だけ再帰）。
    if (AFFILIATE_REDIRECT.test(u.hostname)) {
      for (const [k, v] of u.searchParams) {
        if (REDIRECT_URL_PARAM.test(k) && /^https?:\/\//.test(v)) return cleanStoreUrl(v);
      }
      // 行き先が取り出せないラッパーは導線として使えない（ラッパーのまま配るよりは落とす）。
      return "";
    }
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

  // ポケモン（カードはトレカ判定が先に拾う。ここはグッズ・コラボ商品＝pokemon_goodsと同じジャンル）
  if (/ポケモン|pokemon|ポケセン|ピカチュウ/i.test(t)) {
    return "ポケモン";
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
