/**
 * 「壁時計を読む面」を全部呼んで、結果を1行ずつ出す（`npm run audit:clock` の子プロセス）。
 *
 * ここに並んでいるのは **今が何時かで答えが変わりうる入口**。同じ日本時間の日であれば、
 * 何時に回しても・どのTZの箱で回しても、出力は1バイトも変わってはいけない。
 * 変わったら、それが「巡回した時刻によってサイトの日付が変わる」バグそのもの。
 *
 * 実測の裏付け（2026-08-16 ミス24）: cardChusen の締切解決は JST 06:39 に回すと
 * 全部1日前になり、JST 12:00 に回すと正しかった。この差をここで機械が見る。
 */
import { jstYearMonth, nowInstant, todayJst } from "../src/lib/date";
import { buildCardChusenItems, parseCardChusen, parseDue } from "../src/scrapers/cardChusen";
import { extractDateAndEventFromText, resolveMonthDay } from "../src/scrapers/util";
import { pickRecentPageSitemaps } from "../src/scrapers/kujimap";
import { resolvePastMonthDay } from "../src/scrapers/nyukaNow";
import { buildOnePieceItem } from "../src/scrapers/onepieceCard";
import { storeWhenLabel } from "../src/lib/stores";
import { withLiveStoreDeadline } from "../src/lib/itemFilter";

/** 検証する瞬間。**同じグループ内は同じ日本時間の日**（＝出力が一致しなければならない）。 */
export const CLOCK_GROUPS: { name: string; jstDay: string; instants: string[] }[] = [
  {
    name: "通常日",
    jstDay: "2026-08-16",
    instants: [
      "2026-08-15T15:00:00Z", // JST 00:00 ちょうど
      "2026-08-15T21:39:06Z", // JST 06:39 ＝ 実際に事故が起きた巡回時刻
      "2026-08-15T23:59:59Z", // JST 08:59:59（UTCではまだ前日）
      "2026-08-16T00:00:00Z", // JST 09:00（UTCが追いつく瞬間）
      "2026-08-16T14:59:59Z", // JST 23:59:59
    ],
  },
  {
    name: "月またぎ",
    jstDay: "2026-09-01",
    instants: [
      "2026-08-31T15:00:00Z", // JST 9/1 00:00（UTCはまだ8月＝月別ページURLが前月になる型）
      "2026-08-31T23:59:00Z", // JST 9/1 08:59
      "2026-09-01T14:59:00Z", // JST 9/1 23:59
    ],
  },
  {
    name: "年またぎ",
    jstDay: "2027-01-01",
    instants: [
      "2026-12-31T15:00:00Z", // JST 1/1 00:00（UTCはまだ前年＝年の解決が1年ズレる型）
      "2027-01-01T14:59:00Z", // JST 1/1 23:59
    ],
  },
];

const ymd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "null");

// cardchusen の実物と同じ形の最小HTML。相対表記（本日/明日）と絶対表記を1件ずつ持たせる。
const CARD_HTML =
  "</head>" +
  '<div class="board-card__tags"><span class="board-cond__txt">会員</span></div>' +
  '<p class="board-card__store" title="ポケモンカードゲーム 拡張パック テスト弾">A店</p>' +
  '<div class="board-card__due"> 締切 本日 22:00 </div>' +
  '<a class="board-card__cta" href="https://example.com/a">応募</a>' +
  '<div class="board-card__tags"><span class="board-cond__txt">レシート</span></div>' +
  '<p class="board-card__store" title="ポケモンカードゲーム 拡張パック テスト弾">B店</p>' +
  '<div class="board-card__due"> 締切 明日 23:59 </div>' +
  '<a class="board-card__cta" href="https://example.com/b">応募</a>' +
  '<div class="board-card__tags"><span class="board-cond__txt">誰でも</span></div>' +
  '<p class="board-card__store" title="ポケモンカードゲーム 拡張パック テスト弾">C店</p>' +
  '<div class="board-card__due"> 締切 9/16(水) 23:59 </div>' +
  '<a class="board-card__cta" href="https://example.com/c">応募</a>';

const KUJIMAP_INDEX = [
  "2026-06",
  "2026-07",
  "2026-08",
  "2026-09",
  "2026-12",
  "2027-01",
]
  .map((ym) => `<loc>https://kujimap.com/sitemap-pt-page-p1-${ym.replace("-", "-")}.xml</loc>`)
  .join("");

/** いま（＝差し替えられた壁時計）で1回分の観測を出す。 */
export function probeLines(): string[] {
  const out: string[] = [];
  const add = (k: string, v: unknown) => out.push(`${k}\t${String(v)}`);

  // ① 「今日」そのもの
  add("todayJst", ymd(todayJst()));
  add("jstYearMonth(0)", JSON.stringify(jstYearMonth(0)));
  add("jstYearMonth(1)", JSON.stringify(jstYearMonth(1)));
  add("jstYearMonth(2)", JSON.stringify(jstYearMonth(2)));

  // ② 収集元の相対表記の解決（基準日を省略＝「今日」に頼る呼び方をわざと使う）
  add("parseDue(本日)", ymd(parseDue("締切 本日 22:00")?.date));
  add("parseDue(明日)", ymd(parseDue("締切 明日 23:59")?.date));
  add("parseDue(絶対)", ymd(parseDue("締切 9/16(水) 23:59")?.date));
  add("parseDue(label)", parseDue("締切 本日 22:00")?.label ?? "null");

  // ③ 年の無い日付の解決（年またぎで前年/翌年に倒れないか）
  add("resolveMonthDay(1/5)", ymd(resolveMonthDay(1, 5)));
  add("resolveMonthDay(12/28)", ymd(resolveMonthDay(12, 28)));
  add("resolvePastMonthDay(1/5)", ymd(resolvePastMonthDay(1, 5)));
  add("extractDate(8月20日)", ymd(extractDateAndEventFromText("8月20日 発売").date));

  // ④ 保存する行そのもの（スクレイプの出力＝DBに書き込まれる値）
  const items = buildCardChusenItems(parseCardChusen(CARD_HTML));
  add(
    "cardChusen.item",
    items.map((i) => `${i.title}|${ymd(i.eventDate as Date)}|${i.highlights}|${i.stores}`).join(" ;; ")
  );

  // ⑤ 掲載範囲・表示の可否（月別サイトマップの選択・掲載判定）
  add("kujimap.recentSitemaps", pickRecentPageSitemaps(KUJIMAP_INDEX).length);
  add(
    "onepiece.build(9月)",
    buildOnePieceItem({
      url: "https://example.com/op17",
      title: "テスト弾",
      cat: "ブースター",
      date: null,
      monthText: "2026年9月",
      price: null,
      imageUrl: null,
    })
      ? "載せる"
      : "載せない"
  );

  // ⑥ 読んだ瞬間に today から作る表示（本日/明日・受付前・いちばん急ぐ締切）
  const store = { name: "A店", url: null, form: "抽選", when: "〜8/16 22:00", note: null, at: "2026-08-16", kind: "締切" as const };
  add("storeWhenLabel", storeWhenLabel(store, todayJst()));
  const row = {
    id: 1,
    source: "card_chusen",
    title: "テスト弾",
    url: null,
    eventDate: new Date("2026-08-10T00:00:00Z"),
    price: null,
    imageUrl: null,
    stores: JSON.stringify([
      { ...store, at: "2026-08-10" },
      { ...store, name: "C店", at: "2026-09-16", when: "〜9/16 23:59" },
    ]),
  };
  add("withLiveStoreDeadline", ymd(withLiveStoreDeadline(row, todayJst()).eventDate as Date));

  return out;
}

if (process.argv[1] && process.argv[1].endsWith("clockProbe.ts")) {
  const setNow = (globalThis as { __setFakeNow?: (ms: number) => void }).__setFakeNow;
  if (!setNow) throw new Error("fakeClock.mjs が読み込まれていない（audit:clock から実行すること）");
  for (const g of CLOCK_GROUPS) {
    for (const iso of g.instants) {
      setNow(Date.parse(iso));
      // 時計が本当に差し替わっているかを毎回確認する（空振りする検査を作らないため）。
      // この行だけは比較対象から外す（瞬間そのものは当然グループ内で違う）。
      console.log(`##NOW\t${g.name}\t${g.jstDay}\t${iso}\t${nowInstant().toISOString()}`);
      for (const line of probeLines()) console.log(`${g.name}\t${line}`);
    }
  }
}
