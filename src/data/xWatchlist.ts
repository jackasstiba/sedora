// X巡回の対象アカウント（＝転売相場のシグナル源）。
// 出典: レアレーダー競合調査で収集した266アカウント（Vault: Projects/sedori_radar_competitors）
// のうち「実売相場・高騰・最安値を発信」「予約/抽選/再販を速報」する層をジャンル別に抽出したもの。
// ノウハウ系インフルエンサー・中国輸入・ノイズは商品/相場シグナルにならないので除外。
//
// 使い方（巡回の型）:
//  1. まず横断・相場サイト系（cluster:"cross"/tier:"price"）で直近の高騰/高額実売を拾う
//  2. 次に狙うジャンルの cluster を price→alert の順に巡回（相場で妙味判定→速報で仕込み対象を拾う）
//  3. 各件を kind:"new"（レアレーダー未掲載）か kind:"resale"（既存の相場付与）に振り分け、
//     scripts/x_watch/x_watch_inbox.json に追記 → `npm run ingest:x` で取り込む
//     ※ 新規でも既存スクレイパー商品に一致すればソース被り防止のため自動で「統合（相場付与）」される
//
// メンテ: 実運用で命中率の高いアカウントを上へ。枯れたら競合一覧から補充。

export type XWatchAccount = {
  handle: string; // @なし
  label: string;
  tier: "price" | "alert"; // price=相場/実売発信, alert=予約/抽選/再販速報
  cluster: "cross" | "pokeca" | "tcg" | "kuji" | "figure" | "sneaker" | "onepiece" | "dbz" | "yugioh_mtg";
  focus: string;
};

export const X_WATCHLIST: XWatchAccount[] = [
  // ── 横断（複数ジャンルの実売相場・最安値・再販） ──
  { handle: "otakarasan9", label: "メルカリ最安値", tier: "price", cluster: "cross", focus: "ワンピ/ポケカ/ガンプラ/一番くじ" },
  { handle: "mercariKING", label: "日刊メルカリ新聞", tier: "price", cluster: "cross", focus: "トレカ/一番くじ/ガンプラ" },
  { handle: "tenbai_hakase", label: "転売博士(国内1位)", tier: "price", cluster: "cross", focus: "横断・プレ値" },
  { handle: "tenbai_info0222", label: "転売info(再販/お得速報)", tier: "alert", cluster: "cross", focus: "再販/お得" },

  // ── ポケカ（最大の主戦場。相場×投資×抽選予約が厚い） ──
  { handle: "awahime_0005", label: "ポケカ相場bot", tier: "price", cluster: "pokeca", focus: "ポケカ相場" },
  { handle: "pokeca_kauhito", label: "ポケカを買う人(投資/高騰/速報)", tier: "price", cluster: "pokeca", focus: "ポケカ高騰" },
  { handle: "pokeca_report", label: "ポケカ相場レポート(ポケリバ)", tier: "price", cluster: "pokeca", focus: "ポケカ相場" },
  { handle: "minnato_Pokemon", label: "トレカ相場情報局 ミント", tier: "price", cluster: "pokeca", focus: "ポケカ相場" },
  { handle: "pokemon_yosou", label: "ポケカ予想調査隊(高騰予想)", tier: "price", cluster: "pokeca", focus: "ポケカ高騰予想" },
  { handle: "oppi987", label: "絶版ポケカ情報ch", tier: "price", cluster: "pokeca", focus: "絶版ポケカ" },
  { handle: "pokecamatomeru", label: "ポケカ速報(予約抽選)", tier: "alert", cluster: "pokeca", focus: "ポケカ予約抽選" },
  { handle: "pokecachan", label: "ポケカ予約速報", tier: "alert", cluster: "pokeca", focus: "ポケカ予約" },

  // ── トレカ全般（相場サイト本体／指数／横断速報） ──
  { handle: "toreca_chart151", label: "みんなのトレカ相場", tier: "price", cluster: "tcg", focus: "トレカ相場(サイト本体)" },
  { handle: "torecarte", label: "とれかるて(相場指数)", tier: "price", cluster: "tcg", focus: "トレカ相場指数" },
  { handle: "tcgprice_op2", label: "トレカプライス", tier: "price", cluster: "tcg", focus: "ワンピカ相場" },
  { handle: "tcg_marketP", label: "トト｜トレカ相場データ", tier: "price", cluster: "tcg", focus: "トレカ相場" },
  { handle: "TCG__Nexus", label: "TCG_Nexus(買取/投資/相場/定価)", tier: "price", cluster: "tcg", focus: "トレカ総合相場" },
  { handle: "Amichi_poke", label: "アミち(TCG速報/相場分析)", tier: "price", cluster: "tcg", focus: "TCG相場分析" },
  { handle: "you__pokeka", label: "ゆう(トレカ相場/トレンド)", tier: "price", cluster: "tcg", focus: "トレカ相場" },
  { handle: "Meisy_TCG_News", label: "メイシィ(トレカ最新情報)", tier: "alert", cluster: "tcg", focus: "トレカ速報" },
  { handle: "y_toreca", label: "トレカ再販予約速報", tier: "alert", cluster: "tcg", focus: "トレカ再販予約" },
  { handle: "gamestylejp", label: "トレカスタイル(抽選予約)", tier: "alert", cluster: "tcg", focus: "トレカ抽選予約" },
  { handle: "tenpoko10", label: "くらべちゃん(買取比較)", tier: "price", cluster: "tcg", focus: "トレカ買取" },
  { handle: "Kaitori_k1", label: "K1大阪トレカ買取", tier: "price", cluster: "tcg", focus: "トレカ買取相場" },

  // ── 一番くじ（各賞の実売相場が構造化テキストで拾いやすい＝命中率高） ──
  { handle: "kuji_dachs", label: "一番くじ相場情報局", tier: "price", cluster: "kuji", focus: "一番くじ各賞相場(実績あり)" },
  { handle: "kazoebito", label: "あり｜くじ店舗数まとめ", tier: "alert", cluster: "kuji", focus: "一番くじ在庫/店舗" },
  { handle: "1BANPredatorTOY", label: "ぷれでたー(くじ/ガチャ速報)", tier: "alert", cluster: "kuji", focus: "一番くじ/ガチャ" },

  // ── フィギュア（プライズ/予約の比較・相場） ──
  { handle: "Figure_Daisuki", label: "フィギュア速報(価格比較)", tier: "price", cluster: "figure", focus: "フィギュア相場" },
  { handle: "mitsui_figure", label: "三井(フィギュア/一番くじ)", tier: "price", cluster: "figure", focus: "フィギュア/くじ" },
  { handle: "op_fig", label: "ワンピフィギュア予約&比較", tier: "alert", cluster: "figure", focus: "ワンピフィギュア予約" },

  // ── スニーカー（抽選/価格比較） ──
  { handle: "snkrprice", label: "SNKR PRICE(価格比較/抽選)", tier: "price", cluster: "sneaker", focus: "スニーカー相場" },
  { handle: "SneakerCase23", label: "スニケス(抽選)", tier: "alert", cluster: "sneaker", focus: "スニーカー抽選" },

  // ── タイトル別トレカ速報（ゲーム別に速報を分けるのが界隈の定石） ──
  { handle: "onepiecenyuka", label: "ワンピカ速報(抽選再販予約)", tier: "alert", cluster: "onepiece", focus: "ワンピカ" },
  { handle: "dragon777_jp", label: "相場師ドラゴン(トレカ最高値)", tier: "price", cluster: "dbz", focus: "トレカ高値" },
  { handle: "doragobocard", label: "DBカード入荷速報", tier: "alert", cluster: "dbz", focus: "ドラゴンボールカード" },
  { handle: "Yugioh_Cardsz", label: "遊戯王/MTG 再販速報", tier: "alert", cluster: "yugioh_mtg", focus: "遊戯王/MTG" },
  { handle: "necoMTG", label: "つきみ(MTG高騰)", tier: "price", cluster: "yugioh_mtg", focus: "MTG高騰" },
];

/** 巡回を効率化するためのクラスタ順（横断→ジャンル）。UI/スクリプトから参照可能。 */
export const X_WATCH_CLUSTER_ORDER: XWatchAccount["cluster"][] = [
  "cross", "pokeca", "tcg", "kuji", "figure", "sneaker", "onepiece", "dbz", "yugioh_mtg",
];
