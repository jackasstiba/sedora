import { getItems } from "./items";
import { daysUntil, displayEventType, todayJst } from "./date";
import type { FactCounts } from "./xDraftText";

// 投稿文に書いてよい「数」を、サイトが今見せているデータから数える。
// **下書きを作るときと、送る直前の両方で同じ関数を通す**（作ってから送るまでに腐るため）。
//
// 数える対象は必ず getItems({}) ＝掲載スコープ。自前の where で数え直すと
// 「サイトが載せない行」まで数に入る（[[System/mistakes]] の再発型）。

type Row = {
  id: number;
  source: string;
  title: string;
  genre: string;
  eventDate: Date | null;
  eventDateText: string | null;
  eventType: string;
};

export type PostFacts = {
  /** 掲載件数 */
  items: number;
  /** 表示中の行が実際に使っている収集元の数（登録数ではない） */
  sources: number;
  /** これから7日のあいだに日付があるもの */
  within7: number;
  /** 種別が「抽選」の件数 */
  lottery: number;
  /** 表示中のジャンル数 */
  genres: number;
};

export async function loadPostFacts(): Promise<PostFacts> {
  const today = todayJst();
  const all = (await getItems({})) as unknown as Row[];
  const within7 = all.filter(
    (r) => r.eventDate != null && daysUntil(r.eventDate) >= 0 && daysUntil(r.eventDate) <= 7,
  );
  const lottery = all.filter(
    (r) => displayEventType(r.eventType, r.eventDate, r.eventDateText, today) === "抽選",
  );
  return {
    items: all.length,
    sources: new Set(all.map((r) => r.source)).size,
    within7: within7.length,
    lottery: lottery.length,
    genres: new Set(all.map((r) => r.genre)).size,
  };
}

/** 単位ごとの「名乗ってよい数」に畳む（findStaleNumbers 用） */
export function toFactCounts(f: PostFacts): FactCounts {
  return {
    件: [f.items, f.within7, f.lottery],
    収集元: [f.sources],
    ジャンル: [f.genres],
  };
}
