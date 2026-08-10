export type ScrapeContext = {
  /**
   * 詳細ページ取得型スクレイパーの「最後に詳細を取り直した時刻」（sourceId → epoch ms）。
   *
   * 以前は「価格まで取れた行は二度と詳細を取りに行かない」設計だったため、eventType も
   * eventDate も初回取得時のまま**永久に凍結**していた（実測: figisland_pb 250件が全て
   * 「予約受付中」で、247件は 2026-07-21 から一度も更新されていなかった。収集元では
   * 発送月が2ヶ月ずれている行がサンプル40件中6件あった）。
   *
   * 未登録＝最優先(0)として、古い順に毎回一定数だけ取り直す（全件を一巡させる）。
   */
  detailFetchedAt: Map<string, number>;
};

export type ScrapedItem = {
  source: string;
  sourceId: string;
  title: string;
  genre: string;
  subGenre: string | null;
  eventType: string;
  eventDate: Date | null;
  eventDateText: string | null;
  price: string | null;
  url: string;
  imageUrl: string | null;
  // コラボ記事本文からの深掘り（collabo_cafe のみ設定。他ソースは未設定＝null）。
  highlights?: string | null;
  hasLottery?: boolean | null;
  officialUrl?: string | null; // 記事から辿った一次情報（公式キャンペーン/ストア）
  salesChannel?: string | null; // 取扱店の平文（URLなし。ichibanKuji の「■取扱店：…」）
  prizes?: string | null; // 一番くじの各等賞ラインナップ（JSON配列文字列。ichibanKuji のみ）
  stores?: string | null; // 受付中の公式ストア一覧（JSON配列文字列。nyuka_now のみ＝家電・ゲーム機抽選）
};
