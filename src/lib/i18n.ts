// 英語版（/en）の表示文字列。**翻訳は「同じ主張の言い換え」だけ**にする。
//
// 立ち位置の規約（[[System/rules_hatsukore]]）は英語でも同じ:
//  ・裏取りできた事実だけを約束する（未知のラベルは訳さず日本語のまま出す＝勝手な断定を足さない）
//  ・相場・転売・利益の語彙は英語でも出さない（resell / resale / profit / scalp。
//    機械の網は xDraftText.FORBIDDEN_WORDS ＋ auditSelftest の表示層スキャン）
//
// このファイルは**時計を読まない**（clock discipline）。日数→ラベルのような純関数だけ置く。

export type Locale = "ja" | "en";

/** ジャンル語彙（itemFilter.GENRE_ORDER）の英語ラベル。値の同一性はJP文字列のまま保つ
 *  （フィルタ・URL・監査の語彙はJPが正。ここは**表示だけ**を替える）。 */
const GENRE_EN: Record<string, string> = {
  フィギュア: "Figures",
  トレカ: "Trading cards",
  スニーカー: "Sneakers",
  プラモ: "Model kits",
  一番くじ: "Ichiban Kuji",
  くじ: "Kuji (prize lotteries)",
  コラボ: "Collabs & events",
  ポケモン: "Pokémon",
  キャラグッズ: "Character goods",
  玩具: "Toys",
  "ソフビ・アートトイ": "Sofubi & art toys",
  "家電・ゲーム機": "Electronics & consoles",
  "酒・ウイスキー": "Whisky & spirits",
  その他: "Other",
};

export function genreLabel(genre: string, locale: Locale): string {
  if (locale === "ja") return genre;
  return GENRE_EN[genre] ?? genre; // 未知のジャンルは訳さない（勝手な言い換えをしない）
}

/** eventType（表示ラベル）の英語。displayEventType が返しうる語だけを対応表に持ち、
 *  **表に無い語は日本語のまま出す**（知らない種類に断定を足さない＝JPと同じ原則）。 */
const EVENT_LABEL_EN: Record<string, string> = {
  予約: "Pre-order",
  予約開始: "Pre-orders open",
  予約受付中: "Pre-orders open",
  受付開始: "Applications open",
  販売開始: "On sale",
  予約終了: "Pre-orders closed",
  抽選: "Lottery",
  発売: "Release",
  登場予定: "Coming soon",
  登場済み: "Out now",
  再販: "Restock",
  開催: "Event",
};

export function eventTypeLabel(eventType: string, locale: Locale): string {
  if (locale === "ja") return eventType;
  return EVENT_LABEL_EN[eventType] ?? eventType;
}

/** 日付欄の見出し（itemFilter.eventDateHeading が返す日本語）→ 英語。
 *  eventDateHeading の生成規則（`${eventType}日`・「〜中/〜予定」はそのまま・抽選の実データ判定・
 *  「発送予定」）が返しうる語だけを対応表に持ち、**表に無い見出しは日本語のまま出す**
 *  （未知の種別に英語の断定を足さない＝EVENT_LABEL_EN と同じ原則）。 */
const DATE_HEADING_EN: Record<string, string> = {
  発送予定: "Ships (est.)",
  応募締切: "Entry deadline",
  受付開始: "Entries open",
  告知の日付: "Date in announcement",
  予約日: "Pre-order date",
  予約開始日: "Pre-orders open",
  受付開始日: "Entries open",
  販売開始日: "On sale",
  予約終了日: "Pre-orders closed",
  抽選日: "Lottery date",
  発売日: "Release date",
  開催日: "Event date",
  再販日: "Restock date",
  登場日: "Arrival date",
  予約受付中: "Pre-orders open",
  登場予定: "Expected arrival",
};

export function dateHeadingEn(headingJa: string): string {
  return DATE_HEADING_EN[headingJa] ?? headingJa;
}

/** groupItemsByDate が返す日本語の節見出し → 英語。 */
const GROUP_LABEL_EN: Record<string, string> = {
  今日: "Today",
  明日: "Tomorrow",
  今週: "This week",
  それ以降: "Later",
  日付未定: "Date TBD",
};

export function groupLabel(label: string, locale: Locale): string {
  if (locale === "ja") return label;
  return GROUP_LABEL_EN[label] ?? label;
}

/** カウントダウンの残日数 → 英語ラベル（date.countdown の text と同じ意味）。
 *  日本語は date.countdown の text が唯一の定義なので、ここでは持たない（二重定義にしない）。
 *  audit:page の突合（countdownBadgeProblem）が読める形に固定する:
 *  "Today" / "Tomorrow" / "In N days"。 */
export function countdownLabelEn(days: number): string {
  return days === 0 ? "Today" : days === 1 ? "Tomorrow" : `In ${days} days`;
}

/** UI部品の文言。コンポーネントには locale だけ渡し、文言はここに1本化する。 */
export const UI = {
  ja: {
    siteName: "ハツコレ",
    searchPlaceholder: "商品名で検索（例: 初音ミク、ポケカ）",
    searchButton: "検索",
    all: "すべて",
    statusLabel: "種別:",
    whenLabel: "時期:",
    statusTabs: [
      { value: "", label: "すべて" },
      { value: "now", label: "発売中" },
      { value: "reserve", label: "予約" },
      { value: "lottery", label: "抽選" },
      { value: "release", label: "発売・登場" },
    ],
    whenTabs: [
      { value: "", label: "全期間" },
      { value: "week", label: "今週" },
      { value: "month", label: "今月" },
    ],
    hideUndated: "日付未定を隠す",
    clearFilters: "条件をクリア",
    noMatch: "該当する商品が見つかりませんでした。",
    resetFilters: "絞り込みをリセット",
    // 「もっと見る」は audit:page が正規表現で突合する（変えるなら検査側も一緒に）。
    showMore: (remaining: number) => `もっと見る（残り${remaining}件）`,
  },
  en: {
    siteName: "Hatsukore",
    searchPlaceholder: "Search product names (e.g. Hatsune Miku, Pokémon)",
    searchButton: "Search",
    all: "All",
    statusLabel: "Type:",
    whenLabel: "When:",
    statusTabs: [
      { value: "", label: "All" },
      { value: "now", label: "Available now" },
      { value: "reserve", label: "Pre-orders" },
      { value: "lottery", label: "Lotteries" },
      { value: "release", label: "Releases" },
    ],
    whenTabs: [
      { value: "", label: "Any time" },
      { value: "week", label: "This week" },
      { value: "month", label: "This month" },
    ],
    hideUndated: "Hide undated",
    clearFilters: "Clear filters",
    noMatch: "No items match your filters.",
    resetFilters: "Reset filters",
    showMore: (remaining: number) => `Show more (${remaining} remaining)`,
  },
} as const;

export type UiDict = (typeof UI)[Locale];
