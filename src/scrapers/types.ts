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
};
