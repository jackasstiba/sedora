/**
 * 監査の自己テスト（`npm run audit:selftest`）。**検査が本当に鳴るのかを確かめる。**
 *
 * なぜ要るか: 検査は本番を壊さないので、間違っていても咎められずに残る。
 * 実測で何度も踏んだ2つの失敗が、どちらも「出力を見れば分かった」ものだった。
 *   ・**発火しようのない検査を持っているだけ**（セレクタが壊れて0枚を見て「0件」と報告）
 *   ・**誤報**（HEAD/GETの違い・曖昧な日付正規表現・データ層と表示層のズレ／計4回）
 * 本番データに対する「0件」は、鳴るべき入力で鳴ることを別に示さないと意味が無い。
 * ここは**合成した入力**に対して、鳴る／鳴らないの両方を固定する。
 *
 * 実際にこのテストは、書いた直後の displayEventType のバグを1つ捕まえた:
 * 未知の「エントリー受付中」まで「予約終了」に書き換えていた（予約ではないのに予約と断定）。
 */
import { displayEventType, eventPeriodText, isStalePromise, isStalePlan, plannedDateFromText } from "../src/lib/date";
import { mergePrizeEnrichment, parsePrizesJson } from "../src/lib/prizes";
import {
  accumulateUnexplained,
  classifyPageLoss,
  isReportableLoss,
  isReportableVanish,
  pageExcludesPast,
} from "../src/lib/pageLoss";
import { cleanTitle, resolveMonthDay } from "../src/scrapers/util";
import { computeMargin, isPerDrawFee, isSuspectPackPrice } from "../src/lib/margin";
import { dedupeItems, eventDateHeading, productUrlKey } from "../src/lib/itemFilter";
import { officialUrlLabel } from "../src/lib/outbound";
import { extractKujiFee, extractKujiStores } from "../src/scrapers/ichibanKujiEnrich";
import { extractOfficialUrl, isSingleProductUrl } from "../src/scrapers/collaboEnrich";
import { cleanStoreUrl } from "../src/scrapers/aggregatorUtil";
import { kidsLabel } from "../src/scrapers/nikeSnkrs";
import { extractRaffleUrl } from "../src/scrapers/channeltono";
import { buildRecentEndedItem, cleanRestockName, parseEndedStores, parseRestockStores, resolvePastMonthDay } from "../src/scrapers/nyukaNow";
import { cleanProductName as cleanTqProductName, isReleaseTitle } from "../src/scrapers/tenbaiquest";
import { buildKujimapItem, parseKujiDetail, pickRecentPageSitemaps } from "../src/scrapers/kujimap";
import { buildOnePieceItem, parseOnePieceProducts } from "../src/scrapers/onepieceCard";
import { cleanListTitle, hasProductSegment } from "../src/lib/title";
import { extractSoleJan, isGenericImageUrl, pickPageImage, productNameMatches } from "../src/scrapers/imagePick";

// 実物と同じ並び（記事末尾に通販の商品リンクが来る）を再現した最小の記事HTML。
const EVENT_ARTICLE_HTML =
  '<div id="single__container">' +
  '<p>ウマ娘 × KFC コラボ開催!</p>' +
  '<a href="https://www.kfc.co.jp/campaign/umamusume">公式サイト</a>' +
  '<a href="https://anime-store.jp/products/4934054076093">関連グッズ</a>' +
  "</div>";

const ymd = (d: Date) => d.toISOString().slice(0, 10);

// 巡回で取り直した prizes（相場なし）に、既存の相場が引き継がれるか。
// 実測: これが無かったため、付与直後に別件で scrape を回しただけで 67件すべての
// 二次相場が消えた（列単位の null 上書き対策では守れない、JSON の中身の問題）。
const PRIZES_OLD = JSON.stringify([
  { label: "A賞", name: "クッション", image: "a.jpg", resalePrice: 1989, resaleText: "中古 ¥1,989" },
  { label: "B賞", name: "皿", image: "b.jpg" },
]);
const PRIZES_FRESH = JSON.stringify([
  { label: "A賞", name: "クッション", image: "a2.jpg" },
  { label: "B賞", name: "皿", image: "b2.jpg" },
]);
const PRIZES_RELABELED = JSON.stringify([{ label: "C賞", name: "タオル", image: "c.jpg" }]);
const merged = parsePrizesJson(mergePrizeEnrichment(PRIZES_OLD, PRIZES_FRESH));
const relabeled = parsePrizesJson(mergePrizeEnrichment(PRIZES_OLD, PRIZES_RELABELED));

const today = new Date(Date.UTC(2026, 7, 8)); // 2026-08-08 固定（今日に依存させない）
const PAST = "2023年4月発送予定";
const FUTURE = "2027年4月発送予定";
const THIS_MONTH = "2026年8月発送予定"; // 月精度は月末に倒すので「まだ過ぎていない」

type Case = { name: string; fn: () => unknown; want: unknown };

const cases: Case[] = [
  // ── 期限切れの約束ラベル ────────────────────────────────
  // 知っているラベルは表示層で過去形に直す＝検査は鳴らない
  { name: "予約受付中・過去 → 表示が予約終了", fn: () => displayEventType("予約受付中", null, PAST, today), want: "予約終了" },
  { name: "予約受付中・過去 → 検査は鳴らない", fn: () => isStalePromise("予約受付中", null, PAST, today), want: false },
  { name: "登場予定・過去 → 表示が登場済み", fn: () => displayEventType("登場予定", null, PAST, today), want: "登場済み" },
  // 未来・当月は触らない（巻き込み防止。実測で2回間違えた箇所）
  { name: "予約受付中・未来 → そのまま", fn: () => displayEventType("予約受付中", null, FUTURE, today), want: "予約受付中" },
  { name: "予約受付中・当月 → そのまま（月末に倒す）", fn: () => displayEventType("予約受付中", null, THIS_MONTH, today), want: "予約受付中" },
  { name: "予約開始・過去 → そのまま（受付が始まった、の意味）", fn: () => displayEventType("予約開始", null, PAST, today), want: "予約開始" },
  // 知らないラベルは**書き換えず、検査に出す**（勝手な断定を足さない）
  { name: "未知『販売予定』・過去 → 書き換えない", fn: () => displayEventType("販売予定", null, PAST, today), want: "販売予定" },
  { name: "未知『販売予定』・過去 → 検査が鳴る", fn: () => isStalePromise("販売予定", null, PAST, today), want: true },
  { name: "未知『エントリー受付中』・過去 → 検査が鳴る", fn: () => isStalePromise("エントリー受付中", null, PAST, today), want: true },
  { name: "未知『販売予定』・未来 → 鳴らない", fn: () => isStalePromise("販売予定", null, FUTURE, today), want: false },
  // 約束でないラベルは対象外（発売済みは相場の価値がある＝落としても書き換えてもいけない）
  { name: "発売・過去 → 鳴らない", fn: () => isStalePromise("発売", null, PAST, today), want: false },
  { name: "開催・過去 → 鳴らない", fn: () => isStalePromise("開催", null, PAST, today), want: false },

  // ── 日付の読み方（過去に2回誤読した書式を固定する） ──────────
  { name: "「2026年08月下旬」は月末に倒す", fn: () => plannedDateFromText("2026年08月下旬登場予定")?.toISOString().slice(0, 10), want: "2026-08-31" },
  { name: "「2026年08月05週」を8月5日と読まない", fn: () => plannedDateFromText("2026年08月05週登場予定")?.toISOString().slice(0, 10), want: "2026-08-29" },
  { name: "未来を約束しない文は判定しない", fn: () => plannedDateFromText("2026年8月6日に発売しました"), want: null },
  { name: "日付未定の過ぎた予定は落とす", fn: () => isStalePlan(null, "2026年06月04週登場予定", today), want: true },
  { name: "日付未定の未来の予定は残す", fn: () => isStalePlan(null, "2026年09月下旬登場予定", today), want: false },

  // ── 巡回が後付けの二次相場を潰さないか（実測で67件が消えた型） ──────────
  { name: "再スクレイプでも二次相場が残る", fn: () => merged?.find((p) => p.label === "A賞")?.resalePrice, want: 1989 },
  { name: "相場は引き継ぐが賞の内容は新しい方を採る", fn: () => merged?.find((p) => p.label === "A賞")?.image, want: "a2.jpg" },
  { name: "元々相場が無い賞には足さない", fn: () => merged?.find((p) => p.label === "B賞")?.resalePrice, want: undefined },
  { name: "賞の構成が変わったら相場を付け替えない", fn: () => relabeled?.find((p) => p.label === "C賞")?.resalePrice, want: undefined },

  // ── 年の無い日付の解決（実測10件が嘘の未来日になっていた型） ──────────
  // 基準日は 2026-08-08。「基準にいちばん近い年」を選ぶ。
  { name: "2ヶ月前の日付を翌年に化けさせない", fn: () => ymd(resolveMonthDay(6, 2, today)), want: "2026-06-02" },
  { name: "4ヶ月前の日付も今年のまま", fn: () => ymd(resolveMonthDay(4, 28, today)), want: "2026-04-28" },
  { name: "近い未来はそのまま今年", fn: () => ymd(resolveMonthDay(9, 20, today)), want: "2026-09-20" },
  { name: "年またぎの先行情報は翌年", fn: () => ymd(resolveMonthDay(1, 7, today)), want: "2027-01-07" },
  { name: "基準を記事の投稿日にすると当時の年で読む", fn: () => ymd(resolveMonthDay(4, 28, new Date(Date.UTC(2026, 3, 20)))), want: "2026-04-28" },

  // ── 掲載減の理由分け（実測: 閾値だけの検査がスニーカーで毎日誤報していた型） ──────
  // 「暦のせいで減った」を故障と鳴らさない／「コード変更で削った」を見逃さない、の両方を固定する。
  {
    // 過去日を載せないページ（/genre/*）で、発売日が昨日になった行が抜けた＝正常
    name: "日付が過ぎて抜けた分は『説明済み』",
    fn: () =>
      classifyPageLoss("/genre/スニーカー", [{ id: 1, inDb: true, eventDate: new Date(Date.UTC(2026, 7, 7)) }], today)
        .expired,
    want: 1,
  },
  {
    name: "日付が過ぎて抜けた分は指摘に数えない",
    fn: () =>
      classifyPageLoss("/genre/スニーカー", [{ id: 1, inDb: true, eventDate: new Date(Date.UTC(2026, 7, 7)) }], today)
        .unexplained.length,
    want: 0,
  },
  {
    // /premium は**過去も意図して載せる**。ここで「日付が過ぎたから」を言い訳にすると、
    // この検査が生まれた事件（/premium 63→36件）をまさに見逃す。
    name: "/premium では過去日は消える理由にならない",
    fn: () =>
      classifyPageLoss("/premium", [{ id: 1, inDb: true, eventDate: new Date(Date.UTC(2026, 7, 7)) }], today)
        .unexplained.length,
    want: 1,
  },
  { name: "/premium は過去日を載せるページ", fn: () => pageExcludesPast("/premium"), want: false },
  { name: "/release/* も過去日を載せるページ", fn: () => pageExcludesPast("/release/2026-08"), want: false },
  { name: "/genre/* は過去日を載せないページ", fn: () => pageExcludesPast("/genre/トレカ"), want: true },
  {
    // URL重複の解消で代表に畳まれた行は「商品はまだページにある」＝説明済み（2026-08-15）。
    name: "URL重複で畳まれた行は『説明済み』",
    fn: () =>
      classifyPageLoss(
        "/genre/一番くじ",
        [{ id: 1, inDb: true, eventDate: new Date(Date.UTC(2026, 7, 29)), officialUrl: "https://1kuji.com/products/hxh11" }],
        today,
        new Set(["1kuji.com/products/hxh11|2026-08-29"])
      ).merged,
    want: 1,
  },
  {
    name: "表示側に同じ商品キーが無い消失は従来どおり説明がつかない",
    fn: () =>
      classifyPageLoss(
        "/genre/一番くじ",
        [{ id: 1, inDb: true, eventDate: new Date(Date.UTC(2026, 7, 29)), officialUrl: "https://1kuji.com/products/hxh11" }],
        today,
        new Set()
      ).unexplained.length,
    want: 1,
  },
  {
    name: "収集元から消えた行は『説明済み』",
    fn: () => classifyPageLoss("/genre/トレカ", [{ id: 1, inDb: false, eventDate: null }], today).gone,
    want: 1,
  },
  {
    name: "日付未定のまま消えた行は説明がつかない",
    fn: () => classifyPageLoss("/genre/トレカ", [{ id: 1, inDb: true, eventDate: null }], today).unexplained.length,
    want: 1,
  },
  // 閾値: /premium 事件（63→36・説明なし27件）は鳴る／代表入れ替えの1〜2件は鳴らない
  { name: "/premium 63→36件・説明なし27件は鳴る", fn: () => isReportableLoss(63, 36, 27), want: 27 },
  { name: "総数が減っていなければ鳴らない（代表の入れ替え）", fn: () => isReportableLoss(63, 63, 2), want: 0 },
  { name: "説明なしが2件だけなら鳴らない", fn: () => isReportableLoss(100, 98, 2), want: 0 },
  // 「消えた行」には代表の入れ替えで入れ替わった分も混じるので、**実際に減った数**を上限にする
  { name: "説明なしは実際に減った数を上限にする", fn: () => isReportableLoss(100, 90, 30), want: 10 },

  // ── ページが丸ごと消えたとき（実測 2026-08-11: /genre/ソフビ・アートトイ が在籍1件の
  //    日付切れで消え、ERROR になった）。減少と同じく**理由で分ける**ことを固定する。
  {
    // 在籍1件のジャンルは、その1件が過去日になれば必ず消える。毎日鳴る誤報にしない。
    name: "全部が日付切れで消えたページは鳴らない",
    fn: () => isReportableVanish(true, 0),
    want: false,
  },
  {
    // まだ未来の行が残っているのに消えた＝掲載基準かコードが削った（/premium の型）。
    name: "説明のつかない消失があるページは鳴る",
    fn: () => isReportableVanish(true, 1),
    want: true,
  },
  {
    // 理由を出せないものを黙って通すと、この検査が生まれた事件を取り逃がす。
    name: "直前の実行の記録が無ければ鳴る",
    fn: () => isReportableVanish(false, 0),
    want: true,
  },
  // 累計（基準を受け入れてから、説明のつかない形で何件減ったか）
  {
    name: "説明のつかない消失は日をまたいで足し上がる",
    fn: () => accumulateUnexplained({ "/genre/フィギュア": 2 }, { "/genre/フィギュア": 3 }, false)["/genre/フィギュア"],
    want: 5,
  },
  {
    // 基準を受け入れたのに累計だけ残ると、受け入れたはずの減少で永久に鳴る＝消せない警告。
    name: "基準を受け入れたら累計は0に戻る",
    fn: () => Object.keys(accumulateUnexplained({ "/genre/フィギュア": 9 }, {}, true)).length,
    want: 0,
  },
  {
    // 日付未確定でも本文の予定日が過ぎれば掲載基準(dropStalePlans)が外す。**外す側と説明する側で
    // 別の物差しを持つと、暦のせいの消失が「説明なし」に化ける**（実測: audit:tomorrow +30日で
    // /genre/フィギュア の43件がこれだった）。
    name: "過ぎた予定（日付未確定）で外れた行は日付切れ扱い",
    fn: () =>
      classifyPageLoss(
        "/genre/フィギュア",
        [{ id: 1, inDb: true, eventDate: null, eventDateText: "2026年07月04週登場予定" }],
        today
      ).expired,
    want: 1,
  },
  {
    // まだ来ていない予定は外れる理由にならない（外れていたらこちらの都合で削っている）。
    name: "まだ来ていない予定で消えた行は説明がつかない",
    fn: () =>
      classifyPageLoss(
        "/genre/フィギュア",
        [{ id: 1, inDb: true, eventDate: null, eventDateText: "2026年12月04週登場予定" }],
        today
      ).unexplained.length,
    want: 1,
  },
  {
    // 在籍1件のジャンルが開催日を過ぎて消えた実データの再現（#23086・8/10開催が 8/11 に抜けた）。
    // 日付はこのテストの固定日 2026-08-08 に合わせた過去日。expired と分かるから鳴らない。
    name: "在籍1件・開催日が過ぎたジャンルは日付切れで説明がつく",
    fn: () =>
      classifyPageLoss(
        "/genre/ソフビ・アートトイ",
        [{ id: 23086, inDb: true, eventDate: new Date(Date.UTC(2026, 7, 7)) }],
        today
      ).unexplained.length,
    want: 0,
  },

  // ── 2026-08-10 の実地検証（せどらーとして仕入れようとして詰まった型）の固定 ──────
  //
  // ここから下は「直したこと」ではなく「二度と壊れないこと」を押さえる。どれも純関数なので
  // 本番データに依らず、リグレッションをその場で落とせる。

  // (a) くじの「1回いくら」は定価ではない。相場と割ると「引けば必ず儲かる」に読める数字が出る。
  //     実測: 一番くじの参加費850円 と 賞1点の中古¥7,650 で「+800%」。
  { name: "『1回 850円（税込）』は参加費と判定", fn: () => isPerDrawFee("1回 850円（税込）"), want: true },
  { name: "『1回660円』も参加費と判定", fn: () => isPerDrawFee("1回660円"), want: true },
  { name: "通常の定価は参加費ではない", fn: () => isPerDrawFee("2,090円（税込）"), want: false },
  { name: "参加費では定価比を出さない", fn: () => computeMargin("1回 850円（税込）", 7650), want: null },
  { name: "通常の定価では定価比を出す", fn: () => computeMargin("2,090円（税込）", 3700)?.pct, want: 77 },

  // (b) 日付の見出しを eventType から機械的に作らない。プレバンの「2026年10月」は
  //     予約日でも発売日でもなく発送月（「予約日 2026年10月」だと10月に予約が始まると読める）。
  {
    name: "発送予定の日付は見出しも『発送予定』",
    fn: () => eventDateHeading("予約", "プレミアムバンダイ 予約受付中 2026年10月発送予定"),
    want: "発送予定",
  },
  { name: "発送予定でなければ従来どおり", fn: () => eventDateHeading("抽選", "抽選 8/15"), want: "抽選日" },

  // (c) プレバンの発送月が過ぎたら「予約」→「予約終了」（受付中と断定しない新ラベルでも効く）
  { name: "予約・過去 → 表示が予約終了", fn: () => displayEventType("予約", null, PAST, today), want: "予約終了" },
  { name: "予約・未来 → そのまま", fn: () => displayEventType("予約", null, FUTURE, today), want: "予約" },
  { name: "予約・過去 → 検査は鳴らない（表示層で直しているため）", fn: () => isStalePromise("予約", null, PAST, today), want: false },

  // (d) 買いに行ける場所のラベル。販売店名は裏取り済みの事実なので約束してよいが、
  //     受付中かどうかは確認できていないので「予約する」とは書かない。
  { name: "プレバンは店名を出す", fn: () => officialUrlLabel(null, "figisland_pb"), want: "プレミアムバンダイで見る →" },
  { name: "受付状況は約束しない（『予約する』と書かない）", fn: () => /予約する/.test(officialUrlLabel(null, "figisland_pb")), want: false },
  { name: "販売内容が裏取りできない時は公式ページ止まり", fn: () => officialUrlLabel(null), want: "公式ページを見る →" },

  // (e) 一番くじの「1回いくら／どこで引けるか」。これが無いとロットの採算計算ができない。
  {
    name: "一番くじの1回価格を読む",
    fn: () => extractKujiFee('<div class="detail glBox"><ul><li>■メーカー希望小売価格：1回850円(税10％込)</li></ul></div>'),
    want: "1回 850円（税込）",
  },
  {
    name: "一番くじの取扱店を読む",
    fn: () => extractKujiStores('<div class="detail glBox"><ul><li>■取扱店：ファミリーマート、書店、ホビーショップ</li></ul></div>'),
    want: "ファミリーマート、書店、ホビーショップ",
  },
  { name: "取扱店が無ければ捏造しない", fn: () => extractKujiStores('<div class="detail glBox"><ul><li>■発売日：8月29日</li></ul></div>'), want: null },

  // (f) 公式リンクの選び方（2026-08-10 実測の誤誘導）。
  //     イベント記事の本文末尾には無関係な通販商品リンクが並ぶので、URL の見た目だけで
  //     選ぶと「ウマ娘 × KFC」→ ¥23,100 のフィギュア商品ページ、が起きる。
  {
    name: "イベント記事では個別商品ページを公式にしない（次点の会場ページを選ぶ）",
    fn: () =>
      extractOfficialUrl(EVENT_ARTICLE_HTML, { allowSingleProduct: false }),
    want: "https://www.kfc.co.jp/campaign/umamusume",
  },
  {
    name: "グッズ発売記事では個別商品ページを公式にしてよい",
    fn: () =>
      extractOfficialUrl('<div id="single__container"><a href="https://anime-store.jp/products/4934054076093">商品</a></div>', {
        allowSingleProduct: true,
      }),
    want: "https://anime-store.jp/products/4934054076093",
  },
  {
    name: "イベント記事で個別商品ページしか無ければ公式リンクを出さない",
    fn: () =>
      extractOfficialUrl('<div id="single__container"><a href="https://anime-store.jp/products/4934054076093">商品</a></div>', {
        allowSingleProduct: false,
      }),
    want: null,
  },
  // SNS除外の正規表現に境界が無く、末尾が x.com のドメインを丸ごと捨てていた（実測）。
  {
    name: "末尾が x.com のドメインはSNS扱いしない",
    fn: () => extractOfficialUrl('<div id="single__container"><a href="https://sqex.com/campaign/y">公式</a></div>'),
    want: "https://sqex.com/campaign/y",
  },
  { name: "本物の x.com は除外する", fn: () => extractOfficialUrl('<div id="single__container"><a href="https://x.com/foo/status/1">投稿</a></div>'), want: null },

  // (g) 商品を1つも名指ししていない投稿は掲載しない。判定は**位置に依らず**、かつ
  //     表示に選ばれた節に対しても行う（実測: 「…お買い物マラソン開催中です　事前エントリー
  //     お忘れなくどうぞ」がトップの1画面目にカード名「事前エントリーお忘れなくどうぞ」で出ていた）。
  {
    name: "呼びかけだけの投稿は掲載しない（先頭でなくても）",
    fn: () =>
      hasProductSegment(
        "channeltono",
        "もうすぐ8月10日0時より楽天カード4倍デーが開催！さらに楽天お買い物マラソン開催中です　事前エントリーお忘れなくどうぞ"
      ),
    want: false,
  },
  {
    name: "商品名がある投稿は掲載する（巻き添えにしない）",
    fn: () => hasProductSegment("channeltono", "8月4日0時よりレゴ楽天で販売開始！楽天1位へ！限定販売　 LEGO レゴ アイデア The X-Files"),
    want: true,
  },
  {
    name: "商品名がある投稿の表示は商品名だけになる",
    fn: () => cleanListTitle("channeltono", "8月4日0時よりレゴ楽天で販売開始！楽天1位へ！限定販売　 LEGO レゴ アイデア The X-Files"),
    want: "LEGO レゴ アイデア The X-Files",
  },
  {
    name: "公式URLの &amp; をデコードして保存する",
    fn: () =>
      extractOfficialUrl(
        '<div id="single__container"><a href="https://ex.com/campaign/x?a=1&amp;b=2">公式</a></div>'
      ),
    want: "https://ex.com/campaign/x?a=1&b=2",
  },
  { name: "個別商品ページの判定（/products/JAN）", fn: () => isSingleProductUrl("https://anime-store.jp/products/4934054076093"), want: true },
  { name: "個別商品ページの判定（/item/12345）", fn: () => isSingleProductUrl("https://bsp-prize.jp/item/2785343/"), want: true },
  // お知らせ配下の新商品紹介は商品ページではない（実測: これを商品ページ扱いすると
  // サンリオ公式のニュースまで落ちる＝正しいリンクの巻き添え）。
  { name: "お知らせ配下は個別商品ページではない", fn: () => isSingleProductUrl("https://www.sanrio.co.jp/news/goods/mx-donki-photo-badge-20260806/"), want: false },
  { name: "キャンペーンページは個別商品ページではない", fn: () => isSingleProductUrl("https://www.kfc.co.jp/campaign/umamusume"), want: false },

  // ── 2026-08-15 追加: 開催告知除去の宙ぶらりん・告知ラッパー・値引き告知 ──
  // 鳴った側: TRAILING_DATE が日付だけ削り「〜東京・大阪で」と地名＋助詞が残った（実測2件）
  {
    name: "日付告知の手前の地名＋で も一緒に落とす",
    fn: () => cleanTitle("『約束のネバーランド』10周年記念 × プリンセスカフェ、東京・大阪で8月25日より開催!"),
    want: "『約束のネバーランド』10周年記念 × プリンセスカフェ",
  },
  {
    name: "既に切り詰められて保存済みの「〜東京で」も再クリーンで直る",
    fn: () => cleanTitle("『「アオハル・ワンスモア」Drink Stand Fair』東京で"),
    want: "『「アオハル・ワンスモア」Drink Stand Fair』",
  },
  // 鳴らない側: 文中の地名や、末尾が「で」でないタイトルは触らない
  {
    name: "文中の地名は巻き添えにしない",
    fn: () => cleanTitle("仮面ライダーストア東京で販売するグッズ"),
    want: "仮面ライダーストア東京で販売するグッズ",
  },
  {
    name: "「!」で終わる商品名は触らない",
    fn: () => cleanTitle("この素晴らしい世界に祝福を! コラボカフェ"),
    want: "この素晴らしい世界に祝福を! コラボカフェ",
  },
  // 「◯◯」が登場！ ラッパー（実測: pokemon_goods が ichiban_kuji と同じくじを別タイトルで
  // 載せ、同じ 1kuji.com URL のカードが2枚並んだ）
  {
    name: "「◯◯」が登場！は中身の商品名だけにする",
    fn: () => cleanTitle("「一番くじ ポケモンマスターズ EX 7th Anniversary」が登場！"),
    want: "一番くじ ポケモンマスターズ EX 7th Anniversary",
  },
  // 値引き告知だけの断片が商品名として採用されていた（実測: 「最大96％オフ」が一覧に）
  {
    name: "セール告知ツイート（商品名なし）は掲載しない",
    fn: () =>
      hasProductSegment(
        "channeltono",
        "もうすぐ8月14日12時より　駿河屋決算セール第3弾が開催です　最大96％オフ　タイムセールも同時開催です"
      ),
    want: false,
  },
  {
    name: "割引語があっても商品名がある投稿は掲載する",
    fn: () => hasProductSegment("channeltono", "あみあみで30％オフ　METAL STRUCTURE 解体匠機 RX-93 νガンダム"),
    want: true,
  },
  // 節末に残る接続副詞（「〜再販さらに」）は落とす
  {
    name: "節末の「さらに」を落として商品名だけにする",
    fn: () =>
      cleanListTitle(
        "channeltono",
        "もうすぐ8月3日16時よりS.H.Figuarts 呪術廻戦 脹相や伏黒甚爾 再販さらに　五条悟-呪術高専- 再販や夏油傑-呪術高専- 再販が予約開始！即完売注意！ショップまとめ"
      ),
    want: "S.H.Figuarts 呪術廻戦 脹相や伏黒甚爾",
  },

  // ── ストアURLのアフィリラッパー（観点B実使用 2026-08-15 で発見） ──────────
  // 入荷Now の DMM リンクが al.dmm.com/?lurl=<行き先>&af_id=nnow-001 のまま配られていた。
  // ラッパーは行き先URLに展開する（収集元のアフィリIDをユーザーに配らない）。
  {
    name: "al.dmm.com ラッパーは行き先URLに展開する",
    fn: () =>
      cleanStoreUrl(
        "https://al.dmm.com/?lurl=https%3A%2F%2Fwww.dmm.com%2Fmono%2Fhobby%2F-%2Flist%2F%3D%2Farticle%3Dkeyword%2Fid%3D308378%2F&af_id=nnow-001&ch=link_tool&ch_id=link"
      ),
    want: "https://www.dmm.com/mono/hobby/-/list/=/article=keyword/id=308378/",
  },
  {
    name: "行き先を取り出せないラッパーは導線として使わない（空）",
    fn: () => cleanStoreUrl("https://al.dmm.com/?af_id=nnow-001&ch=link_tool"),
    want: "",
  },
  {
    name: "通常ホストの af_id クエリは除去する",
    fn: () => cleanStoreUrl("https://example.com/lottery?af_id=nnow-001&page=2"),
    want: "https://example.com/lottery?page=2",
  },
  {
    name: "Amazon の /dp 正規化は従来どおり",
    fn: () => cleanStoreUrl("https://www.amazon.co.jp/gp/product/B0DDWZWW1Z?tag=abc-22&th=1"),
    want: "https://www.amazon.co.jp/dp/B0DDWZWW1Z",
  },

  // ── 個別商品ページURLによる重複突合（観点B実使用 2026-08-15 で発見） ──────────
  // collabo_cafe の officialUrl と ichiban_kuji の url が同じ 1kuji.com/products/hxh11 なのに
  // タイトル正規化ベースの dedupe を全て素通りして同じくじのカードが2枚並んでいた。
  { name: "商品ページURL: クエリ・大小・末尾スラッシュを吸収", fn: () => productUrlKey("https://1kuji.com/products/HXH11/?utm_source=x"), want: "1kuji.com/products/hxh11" },
  { name: "1kuji の再販売ページ(_2)は同じくじに畳む", fn: () => productUrlKey("https://1kuji.com/products/kimetsu30_2"), want: "1kuji.com/products/kimetsu30" },
  { name: "1kuji 以外のホストの _2 は触らない", fn: () => productUrlKey("https://example.com/products/foo_2"), want: "example.com/products/foo_2" },
  { name: "商品ページでないURLはキーにしない（誤マージ防止）", fn: () => productUrlKey("https://www.kfc.co.jp/campaign/umamusume"), want: null },
  {
    name: "URL一致＋同日ならクロスソースの2枚を1枚に畳む",
    fn: () =>
      dedupeItems([
        { id: 1, source: "collabo_cafe", title: "ハンターハンター × 一番くじ グリードアイランド編", url: "https://collabo-cafe.com/events/x/", officialUrl: "https://1kuji.com/products/hxh11", eventDate: new Date(Date.UTC(2026, 7, 29)), price: null, imageUrl: "a.jpg" },
        { id: 2, source: "ichiban_kuji", title: "一番くじ HUNTER×HUNTER GREED ISLAND ②", url: "https://1kuji.com/products/hxh11", officialUrl: null, eventDate: new Date(Date.UTC(2026, 7, 29)), price: "1回 850円（税込）", imageUrl: "b.jpg" },
      ]).map((x) => x.id).join(","),
    want: "2", // 価格・商品ページを持つ ichiban_kuji 側が代表として残る
  },
  {
    name: "同じ商品コードでも別日（店頭→再販）なら畳まない",
    fn: () =>
      dedupeItems([
        { id: 1, source: "collabo_cafe", title: "鬼滅の刃 一番くじ 上弦の弐", url: "https://collabo-cafe.com/events/y/", officialUrl: "https://1kuji.com/products/kimetsu30", eventDate: new Date(Date.UTC(2026, 6, 30)), price: null, imageUrl: null },
        { id: 2, source: "ichiban_kuji", title: "一番くじ 鬼滅の刃 ～上弦の弐～（再販売）", url: "https://1kuji.com/products/kimetsu30_2", officialUrl: null, eventDate: new Date(Date.UTC(2026, 7, 17)), price: "1回 850円（税込）", imageUrl: null },
      ]).length,
    want: 2,
  },
  {
    name: "?が2重の不正URL（既存クエリ＋?utm_連結）もトラッキングを剥がす",
    fn: () => cleanStoreUrl("https://www.animate-onlineshop.jp/contents/fair_event/detail.php?id=115888&?utm_source=collabo_cafe_dot_com&utm_medium=collabo_cafe_dot_com"),
    want: "https://www.animate-onlineshop.jp/contents/fair_event/detail.php?id=115888",
  },
  {
    name: "?無しでパス末尾に連結された utm も剥がす",
    fn: () => cleanStoreUrl("https://www.sanrio.co.jp/news/goods/pc-ap-atarikuji-20260723/utm_source=collabo_cafe_dot_com&utm_medium=collabo_cafe_dot_com"),
    want: "https://www.sanrio.co.jp/news/goods/pc-ap-atarikuji-20260723/",
  },
  {
    name: "officialUrl のトラッキングを剥がす（収集元露見の防止）",
    fn: () =>
      extractOfficialUrl(
        '<div id="single__container"><a href="https://1kuji.com/products/kimetsu30?utm_source=collabo_cafe_dot_com&amp;utm_id=collabo_cafe_dot_com">公式</a></div>'
      ),
    want: "https://1kuji.com/products/kimetsu30",
  },

  // ── 受付期間・締切の補足表示（観点B実使用 2026-08-15: 「今から間に合うか」が出ていなかった） ──
  {
    name: "一番くじONLINEの予約販売期間は補足に出す",
    fn: () => eventPeriodText(new Date(Date.UTC(2026, 7, 17)), "【予約販売期間】2026年08月17日(月)11:00～2026年08月20日(木)23:59"),
    want: "【予約販売期間】2026年08月17日(月)11:00～2026年08月20日(木)23:59",
  },
  { name: "SNKRSの応募締切（時刻付き）は補足に出す", fn: () => eventPeriodText(new Date(Date.UTC(2026, 7, 15)), "抽選応募締切 8/15 9:10"), want: "抽選応募締切 8/15 9:10" },
  { name: "暦日だけの言い換えは二度書きしない", fn: () => eventPeriodText(new Date(Date.UTC(2026, 7, 17)), "2026年8月17日"), want: null },
  { name: "発送予定は見出し側が扱うので補足に出さない", fn: () => eventPeriodText(new Date(Date.UTC(2026, 9, 1)), "2026年10月発送予定"), want: null },
  { name: "投稿日は商品の日付ではないので出さない", fn: () => eventPeriodText(new Date(Date.UTC(2026, 7, 15)), "投稿日: 2026-08-12"), want: null },
  { name: "日付が無い行は既存の日付ラベル経路に任せる", fn: () => eventPeriodText(null, "抽選応募締切 8/15 9:10"), want: null },

  // ── タイトルのNBSP正規化（観点B実使用 2026-08-15: 「コービー 5」のNBSPが楽天検索URLに %C2%A0 で乗った） ──
  { name: "NBSPは普通の空白にする", fn: () => cleanTitle("コービー 5"), want: "コービー 5" },
  { name: "narrow NBSP・連続空白も1つの空白へ", fn: () => cleanTitle("エア ジョーダン  1"), want: "エア ジョーダン 1" },

  // ── Xミラー抽選記事の応募先抽出（観点B実使用 2026-08-15: 行き止まりカードの解消） ──────────
  {
    name: "記事内の既知抽選プラットフォームリンクを応募先にする（ラッパーは展開）",
    fn: () =>
      extractRaffleUrl(
        '<a href="https://www.amazon.co.jp/dp/B000000000?tag=blog-22">商品</a>' +
          '<a href="https://al.dmm.com/?lurl=https%3A%2F%2Fwww.dmm.com%2Fmono%2Fhobby%2F-%2Flist%2F%3D%2Farticle%3Dkeyword%2Fid%3D308378%2F&af_id=xx-001">DMM</a>'
      ),
    want: "https://www.dmm.com/mono/hobby/-/list/=/article=keyword/id=308378/",
  },
  {
    name: "知らないホストしか無い記事には応募先を付けない（断定しない）",
    fn: () => extractRaffleUrl('<a href="https://www.amazon.co.jp/dp/B000000000">A</a><a href="https://example.com/lottery">B</a>'),
    want: null,
  },

  // ── SNKRSのキッズ版判別（観点B実使用 2026-08-15 で発見） ──────────
  // GS版「コービー 5」¥15,620 が大人版と同名・同URL・同画像で、キッズと分かる表記が無かった。
  { name: "ジュニア subtitle → ジュニア", fn: () => kidsLabel("ジュニア バスケットボールシューズ", ["BOYS", "GIRLS", "KIDS"]), want: "ジュニア" },
  { name: "リトルキッズ subtitle → リトルキッズ", fn: () => kidsLabel("リトルキッズ バスケットボールシューズ", ["KIDS"]), want: "リトルキッズ" },
  { name: "subtitle に語が無くても genders=KIDS で拾う", fn: () => kidsLabel("バスケットボールシューズ", ["KIDS"]), want: "キッズ" },
  { name: "大人（MEN）には付けない", fn: () => kidsLabel("バスケットボールシューズ", ["MEN"]), want: null },

  // ── 入荷Now 受付終了（実績）行（2026-08-15 新設） ──────────
  // 受付窓の短い商材（酒/ソフビ/家電）が「スクレイプの瞬間に窓が閉じている」だけで
  // 恒常的に0件になる穴への対処。基準日は 2026-08-08 固定。
  // 終了した抽選の日付は必ず過去＝「9月19日」を来月に化けさせない（resolveMonthDay とは別規則）。
  { name: "終了日の年無し日付は過去に解決する", fn: () => ymd(resolvePastMonthDay(9, 19, today)), want: "2025-09-19" },
  { name: "1ヶ月前の終了日は今年", fn: () => ymd(resolvePastMonthDay(7, 7, today)), want: "2026-07-07" },
  { name: "当日は今年（未来ではない）", fn: () => ymd(resolvePastMonthDay(8, 8, today)), want: "2026-08-08" },
  {
    name: "直近60日以内の抽選実績 → 受付終了行を出す（受付中とは言わない）",
    fn: () => {
      const row = buildRecentEndedItem("1", "【8月8日更新】ニッカウイスキー各種の抽選・予約情報まとめ",
        [{ name: "やまや", url: "https://example.com/l/1", form: "WEB抽選", date: new Date(Date.UTC(2026, 6, 7)) }], today);
      return row ? `${row.title}|${row.eventDateText}|${row.hasLottery}|${row.stores}` : null;
    },
    want: "ニッカウイスキー|受付終了（直近 7/7）|true|null",
  },
  {
    name: "直近実績が60日より古い（LABUBU型・枯れた記事）は載せない",
    fn: () => buildRecentEndedItem("1", "POP MART LABUBU各種の抽選・予約情報まとめ",
      [{ name: "POP MART", url: "https://example.com/l/2", form: "WEB抽選", date: new Date(Date.UTC(2025, 10, 14)) }], today),
    want: null,
  },
  {
    name: "直近窓内が先着・予約だけ（抽選実績なし）は載せない",
    fn: () => buildRecentEndedItem("1", "ジェラートピケ各種の抽選・予約情報まとめ",
      [{ name: "店舗", url: "https://example.com/l/3", form: "先着販売", date: new Date(Date.UTC(2026, 6, 20)) }], today),
    want: null,
  },
  {
    name: "公式URLが1本も無い実績は載せない（公式ページ表示の約束を守る）",
    fn: () => buildRecentEndedItem("1", "ニッカウイスキー各種の抽選・予約情報まとめ",
      [{ name: "やまや", url: null, form: "WEB抽選", date: new Date(Date.UTC(2026, 6, 20)) }], today),
    want: null,
  },
  {
    name: "受付終了節のパース: 抽選形式・年付き当選発表を読む",
    fn: () => {
      const html = '<h3>やまや</h3><p>対象商品 山崎12年 抽選形式 WEB抽選 開始日 7月1日(水)10:00 当選発表 2026年7月7日 12:00</p><a href="https://example.com/lottery">詳細ページ</a>';
      const s = parseEndedStores(html, today)[0];
      return s ? `${s.name}|${s.form}|${s.date ? ymd(s.date) : null}|${s.url}` : null;
    },
    want: "やまや|WEB抽選|2026-07-07|https://example.com/lottery",
  },
  {
    name: "新しい順の並びに反する年解決は1年戻す（単調非増加）",
    fn: () => parseEndedStores(
      '<h3>A店</h3><p>抽選形式 WEB抽選 開始日 7月7日</p><a href="https://example.com/a">詳細ページ</a>' +
      '<h3>B店</h3><p>抽選形式 WEB抽選 開始日 8月1日</p><a href="https://example.com/b">詳細ページ</a>',
      today
    ).map((s) => (s.date ? ymd(s.date) : null)).join(","),
    want: "2026-07-07,2025-08-01",
  },

  // ── kujimap（一番くじ以外のくじブランド・2026-08-15新設） ──────────
  {
    name: "kujimap: 日精度の開催予定と賞内訳を読む",
    fn: () => {
      const html =
        '</head><h1>セガ ラッキーくじ「テスト」</h1>' +
        '<table><thead><tr><th colspan="2">2026年08月20日開催予定</th><th colspan="2">1セット（72本）内訳</th></tr></thead>' +
        "<tbody><tr><td>S賞</td><td>ぬいぐるみ</td><td>2</td><td>全1種</td></tr>" +
        "<tr><td>A賞</td><td>パネル</td><td>4</td><td>全2種</td></tr></tbody></table>" +
        '<a href="https://twitter.com/share">Tweet</a><a href="https://segaplaza.jp/lp/test/">公式</a>';
      const d = parseKujiDetail(html);
      return d ? `${d.name}|${d.date ? ymd(d.date) : null}|${d.lotSize}|${d.prizes.length}|${d.officialUrl}` : null;
    },
    want: "セガ ラッキーくじ「テスト」|2026-08-20|72|2|https://segaplaza.jp/lp/test/",
  },
  {
    name: "kujimap: アフィリラッパーの通販検索リンクを公式ページと呼ばない",
    fn: () =>
      parseKujiDetail(
        '</head><h1>FFXくじ</h1><table><thead><tr><th>2026年09月12日開催予定</th></tr></thead></table>' +
          '<a href="https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=1&pid=2&vc_url=https%3A%2F%2Fsearch.shopping.yahoo.co.jp%2Fsearch%3Fp%3Dtest">通販</a>'
      )?.officialUrl ?? null,
    want: null,
  },
  {
    name: "kujimap: 発売日が7日以上過去のくじは載せない（古ページのlastmod更新対策）",
    fn: () =>
      buildKujimapItem(
        "https://kujimap.com/segaluck/sega_old",
        { name: "古いくじ", date: new Date(Date.UTC(2026, 5, 1)), monthText: null, lotSize: null, prizes: [], officialUrl: "https://segaplaza.jp/lp/old/" },
        today
      ),
    want: null,
  },
  {
    name: "kujimap: 月精度は月末まで有効・eventDateは合成しない（精度の捏造防止）",
    fn: () => {
      const row = buildKujimapItem(
        "https://kujimap.com/minkuji/min_1",
        { name: "フリューくじ テスト", date: null, monthText: "2026年8月開催予定", lotSize: null, prizes: [{ label: "A賞", name: "ぬいぐるみ", count: null }], officialUrl: "https://furyuprize.com/kuji/lineup/1" },
        today
      );
      return row ? `${row.eventDate}|${row.eventDateText}|${row.genre}|${row.hasLottery}` : null;
    },
    want: "null|2026年8月開催予定|くじ|true",
  },
  {
    name: "kujimap: 公式LPが無いくじは載せない（『公式ページ』表示の約束）",
    fn: () =>
      buildKujimapItem(
        "https://kujimap.com/others/x_kuji",
        { name: "X", date: new Date(Date.UTC(2026, 8, 1)), monthText: null, lotSize: null, prizes: [], officialUrl: null },
        today
      ),
    want: null,
  },
  // ── 同ソースの「月未定→日付確定」二重記事（2026-08-15 実測: トレカ速報BS77・アイカツ） ──
  {
    name: "同ソース同一生タイトルで日付あり/なし混在 → 日付なし側を落とす",
    fn: () => {
      const rows = dedupeItems([
        { id: 1, source: "torecasoku", title: "【バトスピ】BS77", eventDate: new Date(Date.UTC(2026, 10, 21)), eventType: "発売" },
        { id: 2, source: "torecasoku", title: "【バトスピ】BS77", eventDate: null, eventType: "発売" },
      ] as never[]);
      return (rows as { id: number }[]).map((r) => r.id).join(",");
    },
    want: "1",
  },
  {
    name: "日付ありが別日どうし（再販）は両方残す",
    fn: () => {
      const rows = dedupeItems([
        { id: 1, source: "torecasoku", title: "【バトスピ】BS77", eventDate: new Date(Date.UTC(2026, 10, 21)), eventType: "発売" },
        { id: 2, source: "torecasoku", title: "【バトスピ】BS77", eventDate: new Date(Date.UTC(2027, 1, 10)), eventType: "発売" },
      ] as never[]);
      return (rows as { id: number }[]).length;
    },
    want: 2,
  },

  // ── 裏取りできない価格（単位表記なしのBOX級価格）は表示しない ──────────
  { name: "単パック表記でBOX級価格 → 疑い", fn: () => isSuspectPackPrice("トレカ", "【WS】ブースターパック anemoi", "52,800円"), want: true },
  { name: "BOX表記があれば疑わない", fn: () => isSuspectPackPrice("トレカ", "【WS】ブースターパック anemoi 【10パック入りBOX】", "8,800円"), want: false },
  { name: "単パック相当の価格は疑わない", fn: () => isSuspectPackPrice("トレカ", "ブースターパック 世界最強の戦士", "240円"), want: false },
  { name: "トレカ以外は対象外", fn: () => isSuspectPackPrice("プラモ", "ＭＧ ストライカーパック", "3,520円"), want: false },

  // ── 入荷Now restock／転売クエスト発売日投稿（2026-08-15・本人指摘「全然取れてない」） ──
  {
    name: "restock: 店舗テーブルから外部リンクだけ拾いアフィリを掃除する",
    fn: () => {
      const html =
        '</head><h3>【在庫あり】テスト を再販実施中のストア</h3><table>' +
        '<tr><th>LOHACO</th><td><a href="https://nyuka.jp/archives/2349">内部リダイレクト</a></td></tr>' +
        '<tr><th>駿河屋</th><td><a href="https://nyuka-now.com/archives/152225">内部</a></td></tr>' +
        '<tr><th>Amazon</th><td><a href="https://www.amazon.co.jp/dp/B0GKLJ7DHD/?emi=X&#038;tag=nnowapp-22">本体（価格：69,462円）</a></td></tr>' +
        "</table><h2>販売履歴</h2>";
      return parseRestockStores(html)
        .map((s) => `${s.name}|${s.url}|${s.note}`)
        .join(";");
    },
    want: "Amazon|https://www.amazon.co.jp/dp/B0GKLJ7DHD|価格 69,462円",
  },
  {
    name: "restock: 記事タイトル→商品名",
    fn: () => cleanRestockName("【2026年8月15日更新】Nintendo Switch 2の在庫あり・再販入荷情報まとめ"),
    want: "Nintendo Switch 2",
  },
  { name: "転売Q: 発売日投稿を採用する（年4桁必須）", fn: () => isReleaseTitle("【2026年9月16日（水）】ポケモンカードゲーム MEGA"), want: true },
  { name: "転売Q: 年無しの日付投稿は採らない", fn: () => isReleaseTitle("【7月3日（金）】Audio-Technica"), want: false },
  { name: "転売Q: 抽選でも発売日でもない投稿は対象外", fn: () => isReleaseTitle("【完売店舗多数】EGOIST"), want: false },
  { name: "転売Q: ブラケット除去で商品名", fn: () => cleanTqProductName("【2026年9月16日（水）】ポケモンカードゲーム MEGA 拡張パック"), want: "ポケモンカードゲーム MEGA 拡張パック" },

  // ── ワンピースカード公式（2026-08-15新設） ──────────
  {
    name: "onepiece: 商品ブロックから名前・日付・価格・画像を読む",
    fn: () => {
      const html =
        '<a href="/products/boosters/op17/" class="linkListColItem"><img class="lazy" data-src="/img/item.webp">' +
        '<span class="linkListColCat">ブースター</span><h4 class="linkListColTitle">ブースターパック 世界最強の戦士【OP-17】</h4>' +
        '<p class="linkListColPrice"><span class="head">メーカー希望小売価格</span><span class="data">240円(税込)</span></p>' +
        '<time class="newsDate" datetime="2026-08-22">2026.08.22(土)</time></a>';
      const p = parseOnePieceProducts(html)[0];
      return p ? `${p.title}|${p.date ? ymd(p.date) : null}|${p.price}|${p.imageUrl}` : null;
    },
    want: "ブースターパック 世界最強の戦士【OP-17】|2026-08-22|240円|https://www.onepiece-cardgame.com/img/item.webp",
  },
  {
    // 実測: 表示は「2026.10」なのに datetime="2026-10-01" と**サイト側が日を合成**している。
    // 属性でなく表示文言で精度を決める（ミス15「分かっている精度でしか書かない」）。
    name: "onepiece: 表示が月精度なら datetime の合成日を信じない",
    fn: () => {
      const p = parseOnePieceProducts(
        '<a href="/products/eb05/" class="linkListColItem"><h4 class="linkListColTitle">EB-05</h4><time class="newsDate" datetime="2026-10-01">2026.10</time></a>'
      )[0];
      const row = p ? buildOnePieceItem(p, today) : null;
      return row ? `${row.eventDate}|${row.eventDateText}` : null;
    },
    want: "null|2026年10月発売予定",
  },
  {
    name: "onepiece: 発売30日超の過去商品は載せない（全期間一覧のため）",
    fn: () => {
      const p = parseOnePieceProducts(
        '<a href="/products/old/" class="linkListColItem"><h4 class="linkListColTitle">旧弾</h4><time class="newsDate" datetime="2026-06-01">2026.06.01</time></a>'
      )[0];
      return p ? buildOnePieceItem(p, today) : "no-parse";
    },
    want: null,
  },
  {
    name: "onepiece: 発売日の無い行は載せない",
    fn: () => {
      const p = parseOnePieceProducts(
        '<a href="/products/sleeve/" class="linkListColItem"><h4 class="linkListColTitle">スリーブ16</h4></a>'
      )[0];
      return p ? buildOnePieceItem(p, today) : "no-parse";
    },
    want: null,
  },
  {
    // 実測: PINGU&#8217;S がカード名に生のまま本番表示された（stripTags は数値エンティティを戻さない）
    name: "kujimap: 数値エンティティを実文字に戻す",
    fn: () =>
      parseKujiDetail("</head><h1>セガ ラッキーくじ PINGU™ ～PINGU&#8217;S Donut Shop～</h1>")?.name ?? null,
    want: "セガ ラッキーくじ PINGU™ ～PINGU’S Donut Shop～",
  },
  {
    name: "kujimap: サイトマップは直近月のページファイルだけ読む",
    fn: () =>
      pickRecentPageSitemaps(
        "<loc>https://kujimap.com/sitemap-pt-page-p1-2026-08.xml</loc>" +
          "<loc>https://kujimap.com/sitemap-pt-page-p1-2026-05.xml</loc>" +
          "<loc>https://kujimap.com/sitemap-pt-page-p1-2018-03.xml</loc>" +
          "<loc>https://kujimap.com/sitemap-pt-post-p1-2026-08.xml</loc>",
        today
      ).length,
    want: 2,
  },

  // ── 画像の選び方（2026-08-15。「画像がないのが多数ある」の修正で入れた判定） ──────
  // 間違った画像を出すのは、画像が無いより悪い。**採らない側**の条件を固定する。
  {
    name: "画像: 収集元の「画像なし」画像は商品画像ではない",
    fn: () => isGenericImageUrl("https://ota-goods.info/tcg/wp-content/themes/matome/images/no-image_150x150.png"),
    want: true,
  },
  {
    name: "画像: empty.png（トレカマップの画像なし）も落とす",
    fn: () => isGenericImageUrl("https://d26vgo7frmwa7l.cloudfront.net/common/no-image/master-packs/empty.png"),
    want: true,
  },
  {
    name: "画像: サイト共通OGP・ロゴは商品画像ではない",
    fn: () => isGenericImageUrl("https://www.mugiwara-store.com/ogp.png") && isGenericImageUrl("https://iyec.itoyokado.co.jp/img/usr/common/sitelogo.png"),
    want: true,
  },
  {
    name: "画像: Xのプロフィール画像は使わない（商品でなく、巡回先が割れる）",
    fn: () => isGenericImageUrl("https://pbs.twimg.com/profile_images/1944434211164938240/0KSemXlR_200x200.jpg"),
    want: true,
  },
  {
    // 実測: 拡張子の有無を「汎用画像か」の判定に混ぜていたため、公式の正しい商品画像を
    // 掃除で消しかけた。**消す判定と、新規採用の判定は別物**。
    name: "画像: 拡張子の無い正しい商品画像を汎用画像扱いしない",
    fn: () => isGenericImageUrl("https://www.onepiece-cardgame.com/products/2026/06/18/YyRrZjwZ2Sq8xBaP"),
    want: false,
  },
  {
    name: "画像: 正しい商品画像は落とさない",
    fn: () =>
      isGenericImageUrl("https://m.media-amazon.com/images/I/71KCnUBF3FL._AC_SL1500_.jpg") ||
      isGenericImageUrl("https://segaplaza.jp/images-v2/lottery/a121381_67557a/large/a121381_01.webp"),
    want: false,
  },
  {
    name: "画像: og:image を優先して拾う",
    fn: () =>
      pickPageImage(
        '<meta property="og:image" content="https://example.com/uploads/item.jpg">',
        "https://example.com/p/1"
      )?.url ?? null,
    want: "https://example.com/uploads/item.jpg",
  },
  {
    name: "画像: og が共通ロゴなら本文の投稿画像に落ちる",
    fn: () =>
      pickPageImage(
        '<meta property="og:image" content="https://example.com/ogp.png">' +
          '<img src="/images/common/h_logo.svg"><img src="/mgr/wp-content/uploads/2026/06/keyvisual.jpg">',
        "https://example.com/topics/kuji/"
      )?.url ?? null,
    want: "https://example.com/mgr/wp-content/uploads/2026/06/keyvisual.jpg",
  },
  {
    // 実測: 「INSTINCTOY SHOW TOKYO 2026」の楽天検索1位は菅田将暉のBlu-rayだった。
    name: "画像: 検索結果の1位でも商品名が合わなければ借りない",
    fn: () =>
      productNameMatches(
        "INSTINCTOY SHOW TOKYO 2026",
        "菅田将暉 LIVE 2026 in 東京ガーデンシアター 2026.01.25(完全生産限定盤)【Blu-ray】"
      ),
    want: false,
  },
  {
    name: "画像: 表記が縮んだ同一商品は借りてよい（ポケモンカードゲーム→ポケモンカード）",
    fn: () =>
      productNameMatches(
        "ポケモンカードゲーム MEGA 拡張パック “30th CELEBRATION”",
        "【レビューキャンペーン実施中】ポケモンカード 30th CELEBRATION MEGA 拡張パック 30周年 カードゲーム"
      ),
    want: true,
  },
  {
    name: "画像: 付属品（スリーブ等）の出品からは借りない",
    fn: () =>
      productNameMatches("ONE PIECE カードゲーム 4th Anniversary Set", "ONE PIECE カードゲーム 4th Anniversary Set 専用スリーブ 100枚"),
    want: false,
  },
  {
    // JANは一意識別子。存在しないJANでも楽天は無関係な商品を返すので、
    // 「JANがURL/画像URLに入っていること」を確認できたものだけ使う（＝この関数の一意性判定）。
    name: "画像: 記事に商品コードが2つ以上あるときは特定しない",
    fn: () => extractSoleJan("JAN 4580886840045 と 4582770058406 の2商品"),
    want: null,
  },
  {
    name: "画像: 記事の商品コードが1つなら特定する",
    fn: () => extractSoleJan("<a href='https://example.com/search?q=4580886840045'>購入</a> JAN:4580886840045"),
    want: "4580886840045",
  },
];

let ng = 0;
for (const c of cases) {
  const got = c.fn();
  const ok = got === c.want;
  if (!ok) ng++;
  console.log(`${ok ? "OK " : "NG "} ${c.name}${ok ? "" : `\n     got=${JSON.stringify(got)} want=${JSON.stringify(c.want)}`}`);
}
console.log(`\n==== 監査の自己テスト: ${cases.length}件中 ${ng}件が期待と違う ====`);
process.exit(ng === 0 ? 0 : 1);
