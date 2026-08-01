// X巡回の対象アカウント（＝転売相場のシグナル源）。
// レアレーダー競合調査(266件)のうち「実売相場・高騰・最安値」を発信する層を抽出。
// Claude for Chrome での定期巡回時にこの順で見て、転売妙味のある商品／実売相場を拾う。
//
// 使い方（巡回の型）:
//  1. tier:"price" の相場サイト系・メルカリ最安値系を最優先で開き、直近の高騰/高額実売を拾う
//  2. tier:"alert" の予約/抽選/再販速報で「これから出る×抽選/数量限定」の入手困難品を拾う
//  3. 拾った各件を kind:"new"（レアレーダー未掲載の新商品）か kind:"resale"（既存商品の相場）に振り分け、
//     scripts/x_watch/x_watch_inbox.json に追記 → `npm run ingest:x` で取り込む
//
// メンテ: 実運用で命中率の高いアカウントを上へ。枯れたら external の一覧([[sedori_radar_competitors]])から補充。

export type XWatchAccount = {
  handle: string; // @なし
  label: string;
  tier: "price" | "alert"; // price=相場/実売発信, alert=予約/抽選/再販速報
  focus: string; // 主対象ジャンル
};

export const X_WATCHLIST: XWatchAccount[] = [
  // ── 相場・実売（転売妙味の判定＝実売相場） ──
  { handle: "otakarasan9", label: "メルカリ最安値", tier: "price", focus: "ワンピ/ポケカ/ガンプラ/一番くじ" },
  { handle: "mercariKING", label: "日刊メルカリ新聞", tier: "price", focus: "トレカ/一番くじ/ガンプラ" },
  { handle: "kuji_dachs", label: "一番くじ相場情報局", tier: "price", focus: "一番くじ" },
  { handle: "toreca_chart151", label: "みんなのトレカ相場", tier: "price", focus: "トレカ" },
  { handle: "tcgprice_op2", label: "トレカプライス", tier: "price", focus: "ワンピカ" },
  { handle: "awahime_0005", label: "ポケカ相場bot", tier: "price", focus: "ポケカ" },
  { handle: "snkrprice", label: "SNKR PRICE", tier: "price", focus: "スニーカー" },
  { handle: "Figure_Daisuki", label: "フィギュア速報(価格比較)", tier: "price", focus: "フィギュア" },
  { handle: "dragon777_jp", label: "相場師ドラゴン", tier: "price", focus: "トレカ高値" },
  { handle: "tenpoko10", label: "くらべちゃん(買取比較)", tier: "price", focus: "トレカ買取" },

  // ── 予約/抽選/再販の速報（これから出る入手困難品＝転売の仕込み） ──
  { handle: "gamestylejp", label: "トレカスタイル(抽選予約)", tier: "alert", focus: "トレカ抽選予約" },
  { handle: "onepiecenyuka", label: "ワンピカ速報(抽選再販予約)", tier: "alert", focus: "ワンピカ" },
  { handle: "y_toreca", label: "トレカ再販予約速報", tier: "alert", focus: "トレカ再販" },
  { handle: "doragobocard", label: "DBカード入荷速報", tier: "alert", focus: "ドラゴンボールカード" },
  { handle: "Yugioh_Cardsz", label: "遊戯王/MTG 再販速報", tier: "alert", focus: "遊戯王/MTG" },
  { handle: "tenbai_info0222", label: "転売info(再販/お得速報)", tier: "alert", focus: "横断" },
  { handle: "SneakerCase23", label: "スニケス(抽選)", tier: "alert", focus: "スニーカー抽選" },
  { handle: "1BANPredatorTOY", label: "ぷれでたー(くじ/ガチャ速報)", tier: "alert", focus: "一番くじ/ガチャ" },
];
