// 外部リンク（情報元 / 購入導線）の扱いを一元管理する。prisma 非依存の純関数。
//
// item.url はソースによって「公式・商品ページ」だったり「情報元(まとめブログ・Xミラー・
// プライズ告知)」だったりする。これを一律「公式・販売ページで見る」と見せると実態と食い違い、
// ユーザーは結局どこで買えるのか辿り着けない。→ ソースに応じてラベルを出し分け、
// さらに商品名で市場を検索する購入導線を別途用意する。

// item.url が実際に公式/商品ページを指すソース。
const OFFICIAL_URL_SOURCES = new Set([
  "pokemoncard", // ポケモンカード公式(pokemon-card.com)
  "pokemon_goods", // ポケモン公式グッズ(メーカー/取扱店の商品ページ)
  "ichiban_kuji", // 一番くじ倶楽部(BANDAI SPIRITS公式)
  "torecamap", // 各商品の公式販売ページに直リンク
  "nike_snkrs", // Nike SNKRS 公式の商品(launch/t)ページに直リンク
  "nyuka_now", // item.url は各小売の公式・抽選ページ（一次ソース）に直リンク
  "raffle_kuji", // オンラインくじの一次プラットフォーム。item.url は応募ページ(/lotteries/id)に直リンク
  "kujimap", // item.url は各くじブランドの公式LP（segaplaza/furyuprize等）に直リンク。無い行は掲載しない
  "onepiece_card", // ONE PIECEカードゲーム公式の商品ページに直リンク
  "card_chusen", // item.url は各店の応募ページ（抽選システム/店舗告知＝一次）に直リンク
  // 2026-08-18 追加。いずれも公式ストア/公式の抽選告知そのものに直リンクする。
  "mita_draw", // ミタスニーカーズ公式の抽選受付ページ（draw.mita-sneakers.co.jp）
  "chiikawa_market", // ちいかわマーケット公式の商品ページ
  "takaratomy_mall", // タカラトミーモール公式の商品ページ
  "billys", // BILLY'S ENT 公式通販の商品/LAUNCH ページ
  "medicom_toy", // メディコム・トイ公式の商品ページ
  "gashapon", // ガシャポンオフィシャルサイトの商品ページ
]);

/** item.url を「公式ページ」と表記してよいか（それ以外は情報元＝まとめ/告知ページ） */
export function isOfficialUrl(source: string): boolean {
  return OFFICIAL_URL_SOURCES.has(source);
}

/**
 * collabo_cafe の officialUrl（記事から辿った公式/一次リンク）で、実際に「販売内容」まで
 * 見られると約束してよいかを判定する。
 *
 * 背景: officialUrl は記事本文中の最良の外部リンクを1つ選んだだけで、コラボの販売ページとは
 * 限らない（アニメ公式トップ・スポンサー等を拾うことがある＝「販売内容を見る」と書いて
 * 販売内容の無いページへ飛ばす食い違いが起きていた）。実際に公式ページから商品名/価格帯を
 * 取得できた時だけ、その痕跡（「公式販売」または「価格帯」）が highlights に入る。これが
 * ある時だけ「販売内容が見られる」と約束し、無い時は「公式ページを見る」に留める。
 */
export function hasVerifiedSaleContent(highlights: string | null | undefined): boolean {
  return !!highlights && /公式販売|価格帯/.test(highlights);
}

/**
 * officialUrl が指す先が「その商品を売っている公式ストア」だと分かっているソースの、店名ラベル。
 * リンク先が販売サイトだと分かっているならそう書いた方が押される（「公式ページ」では
 * 何が待っているか分からない）。**販売店名までは裏取り済みの事実**なので約束してよいが、
 * 受付中かどうかは別問題なので「予約する」とは書かない（受付状況は確認できていない）。
 */
const OFFICIAL_STORE_LABELS: Record<string, string> = {
  figisland_pb: "プレミアムバンダイで見る →",
};

/** officialUrl ボタンの表示ラベル（実売内容を確認できた時だけ「販売内容」を約束する） */
export function officialUrlLabel(
  highlights: string | null | undefined,
  source?: string
): string {
  if (source && OFFICIAL_STORE_LABELS[source]) return OFFICIAL_STORE_LABELS[source];
  return hasVerifiedSaleContent(highlights)
    ? "公式で販売内容を見る →"
    : "公式ページを見る →";
}

// タイトルが商品名として市場検索に使えるソース。
// Xミラー(channeltono/rarecheck)やイベント(collabo_cafe)は「7月28日10時より…販売開始」等の
// 文章タイトルで、そのまま検索すると無関係な結果になるため購入導線を出さない。
const SEARCHABLE_SOURCES = new Set([
  "figisland",
  "figisland_pb",
  "koretore",
  "torecamap",
  "snkrdunk",
  "pokemoncard",
  "pokemon_goods",
  "ichiban_kuji",
  "nike_snkrs",
  "torecasoku",
  "nyuka_now", // 商品名（Nintendo Switch 2 等）で市場検索できる
  "tenbaiquest", // item.url は楽天検索（収集元は非公開）＝商品名で市場検索できる
  "kujimap", // くじ名（セガ ラッキーくじ「◯◯」等）で市場検索できる
  "onepiece_card", // 商品名（ブースターパック◯◯【OP-17】等）で市場検索できる
  "card_chusen", // 商品名（拡張パック名）で市場検索できる
  "gunpla_resale", // item.url は楽天検索（収集元は非公開）＝商品名で市場検索できる
  "sofvi", // item.url は楽天検索（収集元は非公開）＝商品名で市場検索できる
  // 2026-08-18 追加。いずれもタイトルが「商品名そのもの」（文章タイトルではない）ので、
  // 公式ページに加えて市場検索の導線を出せる＝定価と相場を突き合わせに行ける。
  "chiikawa_market",
  "takaratomy_mall",
  "medicom_toy",
  "gashapon",
  "billys",
  "mita_draw",
]);

/** 「楽天で探す」等の購入導線（商品名検索）を出してよいソースか */
export function hasSearchableTitle(source: string): boolean {
  return SEARCHABLE_SOURCES.has(source);
}

/**
 * 楽天アフィリエイトID（例: `1a2b3c4d.5e6f7g8h.9i0j1k2l.3m4n5o6p` の形）。
 * **未設定なら素の検索URLのまま**にする（＝アフィリ化前と同じ挙動）。
 */
const RAKUTEN_AFFILIATE_ID = (process.env.RAKUTEN_AFFILIATE_ID ?? "").trim();

/**
 * アフィリエイトIDの形だけを確かめる（**緩めに**判定する）。
 *
 * なぜ緩いか: 楽天はIDの厳密な仕様を公開していない。実物を1本もらう前に厳しく縛ると、
 * **正しいIDを弾いて収益ゼロのまま気づかない**という、まさに避けたい壊れ方になる。
 * ここで見るのは「ドット区切りの英数4ブロック」という骨格だけ。
 *
 * 逆に**形が違うものを通してはいけない**理由: 壊れたIDでもリンク自体は楽天に飛ぶので
 * **画面上は完全に正常に見えて、成果だけが付かない**。目視では絶対に見つからない型。
 */
export function isRakutenAffiliateId(v: string): boolean {
  return /^[0-9a-z]{4,12}(\.[0-9a-z]{4,12}){3}$/i.test(v.trim());
}

/**
 * 商品名で楽天市場を検索する素のURL（アフィリエイトを通さない着地先）。
 *
 * **保存・機械での取得（fetch）は必ずこちらを使う。** → `rakutenSearchUrl` の注意書き。
 */
export function rakutenSearchRawUrl(title: string): string {
  return `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(title.trim())}/`;
}

/**
 * 商品名で楽天市場を検索するURL。**収益導線はここ1箇所だけ**。
 *
 * ⚠ **この関数は「画面に出す瞬間」にだけ呼ぶこと。** 戻り値をDBに保存したり、スクリプトから
 * fetch したりしてはいけない。アフィリのURLは踏むと `hb.afl` にクリックが記録されるので、
 * 巡回や画像収集で機械が叩くと、**成果ゼロのクリックだけが毎日自分のIDに積み上がる**
 * （楽天の禁止事項「自ら設置したアフィリエイトリンクを経由して成果を発生させる行為」
 * 「不正クリック」に当たりうる＝アカウント停止＝収益が丸ごと消える）。
 * 実際 2026-08-18 に、画像収集(scripts/backfillImages.ts)と巡回で保存する item.url の
 * 2経路がこの形になっていた。保存も fetch も `rakutenSearchRawUrl` を使う。
 * 保存側に混ざっていないかは audit の `own_affiliate_stored`、
 * 呼び出し側に戻っていないかは audit:selftest の静的スキャンで見張っている。
 *
 * `RAKUTEN_AFFILIATE_ID` があればアフィリエイト経由に包む。IDが無い/形が違うときは
 * **素の検索URLに落とす**（＝リンクは必ず生きている。成果が付かないだけ）。
 * 「壊れたアフィリリンクで変な所へ飛ばす」より「アフィリ無しで正しく飛ぶ」方が常に良い。
 *
 * 形式は**楽天のリンク作成ツールが実際に吐いたリンクから写した**（2026-08-18 実測）:
 *   https://hb.afl.rakuten.co.jp/hgc/<ID>/?pc=<URLをencodeURIComponentしたもの>&link_type=hybrid_url
 * 楽天は仕様を公開していないので、記憶や古いブログではなく**実物が唯一の根拠**。
 *   ・`m=`（モバイル用URL）は**今のツールは吐かない**。`link_type=hybrid_url` が両対応の指定。
 *   ・`ut=`（base64のJSON）はツール側の作成経路の記録なので付けない。
 *   ・`pc=` の中身は**二重エンコードになるのが正しい**（内側の検索URLで日本語が既に %XX 化
 *     されていて、それを更に包むため % が %25 になる）。包まないと内側の & = が
 *     パラメータの区切りと誤読されて着地が壊れる。
 */
export function rakutenSearchUrl(title: string, affiliateId = RAKUTEN_AFFILIATE_ID): string {
  const raw = rakutenSearchRawUrl(title);
  if (!isRakutenAffiliateId(affiliateId)) return raw;
  return `https://hb.afl.rakuten.co.jp/hgc/${affiliateId}/?pc=${encodeURIComponent(raw)}&link_type=hybrid_url`;
}

/**
 * 広告である旨の表示（ステマ規制／楽天アフィリエイトのガイドライン対応）。
 *
 * 楽天のガイドラインは「正しくPR表示がされていない」掲載を禁止事項に挙げ、文言は
 * 「広告」「PR」「宣伝」「プロモーション」等の**日本語**で、**ファーストビュー**に、
 * 一般消費者が視認できる大きさ・色で出すことを求めている
 * （`sponsored` `AD` `Premium partner` は「認識しづらい」として不可）。
 * → 文字列をここに1本化し、全ページ共通ヘッダ直下と、購入導線の隣の2箇所で使う。
 *   実際に本番の全ページに出ているかは `npm run audit:page` が毎回確かめる。
 */
export const AD_DISCLOSURE = "本サイトはアフィリエイト広告（楽天アフィリエイト）を利用しています。";

/** 購入導線の隣に置く一行（そのリンク自体が広告だと、押す直前に分かるようにする）。 */
export const AD_DISCLOSURE_INLINE = "「楽天で探す」は広告（アフィリエイトリンク）です。";

/**
 * 英語版（/en）の広告表示。英語ページの読者に日本語の一文は届かないので言語を合わせる。
 * 楽天ガイドラインの「日本語で」は日本語ページ向けの要件＝日本語ページ側は AD_DISCLOSURE を使う。
 * 実際に /en に出ているかは `npm run audit:page` が見る（checkAdDisclosure が両言語を受ける）。
 */
export const AD_DISCLOSURE_EN = "This site uses affiliate advertising links.";
