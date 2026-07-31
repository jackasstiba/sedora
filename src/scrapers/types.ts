export type ScrapeContext = {
  /** 詳細ページ取得型スクレイパーで、既に価格まで取得済みのためスキップしてよい sourceId 集合 */
  skipDetailIds: Set<string>;
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
};
