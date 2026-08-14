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
import { displayEventType, isStalePromise, isStalePlan, plannedDateFromText } from "../src/lib/date";
import { mergePrizeEnrichment, parsePrizesJson } from "../src/lib/prizes";
import {
  accumulateUnexplained,
  classifyPageLoss,
  isReportableLoss,
  isReportableVanish,
  pageExcludesPast,
} from "../src/lib/pageLoss";
import { cleanTitle, resolveMonthDay } from "../src/scrapers/util";
import { computeMargin, isPerDrawFee } from "../src/lib/margin";
import { eventDateHeading } from "../src/lib/itemFilter";
import { officialUrlLabel } from "../src/lib/outbound";
import { extractKujiFee, extractKujiStores } from "../src/scrapers/ichibanKujiEnrich";
import { extractOfficialUrl, isSingleProductUrl } from "../src/scrapers/collaboEnrich";
import { cleanListTitle, hasProductSegment } from "../src/lib/title";

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
