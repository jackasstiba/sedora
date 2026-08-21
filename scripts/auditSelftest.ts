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
import {
  calendarDate,
  countdownBadgeProblem,
  parseDisplayedDate,
  renderedDateProblems,
  displayEventDateText,
  displayEventType,
  eventDateLabelEn,
  eventPeriodText,
  formatMonthEn,
  formatShortEn,
  hasFrozenRelativeDate,
  isStalePromise,
  isStalePlan,
  jstCalDate,
  monthPrecisionFromTitle,
  plannedDateFromText,
} from "../src/lib/date";
import { countdownLabelEn, eventTypeLabel, genreLabel, groupLabel } from "../src/lib/i18n";
import { isOnlineItem } from "../src/lib/channel";
import { closedStoreRowProblem } from "../src/lib/renderedStores";
import {
  lastDeadline,
  preferredStoreUrl,
  soonestOpenDeadline,
  splitStoresByDeadline,
  storeWhenLabel,
  type StoreEntry,
} from "../src/lib/stores";
import { unfreezeStoreWhen } from "./backfillDisplayText";
import { zeroAdoptionVerdict } from "./health";
import { mergePrizeEnrichment, parsePrizesJson } from "../src/lib/prizes";
import {
  accumulateUnexplained,
  classifyPageLoss,
  productMergeKeys,
  isReportableLoss,
  isReportableVanish,
  pageExcludesPast,
} from "../src/lib/pageLoss";
import { cleanTitle, resolveMonthDay } from "../src/scrapers/util";
import { dateTextConflict, extractDates } from "../src/lib/dateText";
import { parseFigislandHeadingDate } from "../src/scrapers/figisland";
import { extractRafflePeriod } from "../src/scrapers/raffleKujiEnrich";
import { disambiguateSameTitle } from "../src/scrapers/nikeSnkrs";
import { computeMargin, isPerDrawFee, isSuspectPackPrice } from "../src/lib/margin";
import { dedupeItems, dedupeSameSourceSameName, eventDateHeading, liveStoreSummary, matchesQuery, productUrlKey, withLiveStoreDeadline } from "../src/lib/itemFilter";
import { countWatchlist, WATCHLIST } from "../src/lib/watchlist";
import { ROLLOVER_CRON_PATH, cronJstHour, rolloverProblem } from "../src/lib/rollover";
import { imageVerdict } from "../src/lib/deadImage";
import {
  decideNolog,
  isAutomationUserAgent,
  isCountableUserAgent,
  isCrawlerUserAgent,
  isProductionHostname,
  readNologParam,
} from "../src/lib/nolog";
import { buildLaunchPosts, buildPost, findForbidden, findNumberClaims, findStaleNumbers, type DraftRow } from "../src/lib/xDraftText";

/** テスト内の改行。TSの "
" を埋め込むと生成側で壊れやすいので定数にする */
const LF = String.fromCharCode(10);

/** 実測のUA（2026-08-19）。推測で足すと本物の読者を消すので、確かめたものだけを置く。 */
const CLAUDE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Claude/1.32352.1 Chrome/148.0.7778.280 Electron/42.9.2 Safari/537.36 MSIX";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36";
const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";
import { isOfficialUrl, isRakutenAffiliateId, officialUrlLabel, rakutenSearchUrl } from "../src/lib/outbound";
import { extractKujiFee, extractKujiStores } from "../src/scrapers/ichibanKujiEnrich";
import { extractMapUrl, extractOfficialUrl, isSingleProductUrl } from "../src/scrapers/collaboEnrich";
import { cleanStoreUrl } from "../src/scrapers/aggregatorUtil";
import { kidsLabel } from "../src/scrapers/nikeSnkrs";
import { figislandListPlaceholder } from "../src/scrapers/figisland";
import { extractRaffleUrl } from "../src/scrapers/channeltono";
import { buildRecentEndedItem, cleanProductName, cleanRestockName, parseEndedStores, parseRestockStores, resolvePastMonthDay } from "../src/scrapers/nyukaNow";
import { cleanProductName as cleanTqProductName, isReleaseTitle } from "../src/scrapers/tenbaiquest";
import { buildKujimapItem, parseKujiDetail, pickRecentPageSitemaps } from "../src/scrapers/kujimap";
import { buildOnePieceItem, parseOnePieceProducts } from "../src/scrapers/onepieceCard";
import { parseCardChusen, parseDue, productKey, splitSaleConditions } from "../src/scrapers/cardChusen";
import { buildSaleUnits, groupSaleUnits, isSaleUnitGroup, saleUnitLabel } from "../src/lib/saleUnit";
import { cleanGunplaName, parseGunplaCalendar } from "../src/scrapers/gunplaResale";
import { parseTorecasokuList } from "../src/scrapers/torecasoku";
import { sofviEventInfo, sofviProductName } from "../src/scrapers/sofvi";
import { findClockViolations, isClockLinted } from "../src/lib/clockLint";
import { findCrawlViolations, isCrawlLinted } from "../src/lib/crawlLint";
import {
  conflictingJanImages,
  isStoreNoticeImage,
  isTooGenericForImageSearch,
  pickListedImage,
} from "../src/scrapers/imagePick";
import { crawlDecision, lastIsOlderThan } from "../src/scrapers/crawl";
import { itemPeriodMs, overlapsRange } from "../src/lib/itemFilter";
// 2026-08-18 追加の一次ストア6ソース。**巡回しないと確かめられない部分を合成入力で固定する**
// （収集元が落ちていても、直した箇所が壊れていないことは分かる）。
import { parseMedicomDetail } from "../src/scrapers/medicomToy";
import { parseTakaraTomyRelease, takaraTomyEndedEvidence, takaraTomyEventType, takaraTomyGenre, takaraTomyUnavailable, type TakaraTomyCard } from "../src/scrapers/takaratomyMall";
import { baselineWritable } from "./factsBaseline";
import { parseYen } from "../src/lib/margin";
import { chooseVerifiedUrl, isUnreadableUrl, orderedStoreUrls } from "../src/scrapers/verifyStoreUrl";
import { canJudgeIdentity, identityMatchCount, pageShowsProduct } from "../src/lib/identity";
import { cannotSourceImage } from "../src/scrapers/imagePick";
import { normalizeForSearch } from "../src/lib/itemFilter";
import { normalizeBillysBrand, parseBillysLaunch } from "../src/scrapers/billys";
import { parseChiikawaCollection, chiikawaGenre } from "../src/scrapers/chiikawaMarket";
import { popmartEventType, popmartProductUrl, popmartImage } from "../src/scrapers/popmart";
import { parseDatedCollectionHandle, splitCharaStoreTitle, charaStoreGenre } from "../src/scrapers/shopifyCharaStore";
import { parseGundamProducts, parseGundamDate } from "../src/scrapers/gundamGcg";
import { parseHoloSchedule, holoGenre, holoImage, holoTitleWithUnit, isHoloPreorder } from "../src/scrapers/hololiveShop";
import { isQueueItPage, parsePokecenTiles, pokecenGenre } from "../src/scrapers/pokecenOnline";
import { isResaleWorthyGashapon, type GashaponCard } from "../src/scrapers/gashapon";
import { parseMitaDrawDetail } from "../src/scrapers/mitaDraw";
import { monthPlanDate } from "../src/scrapers/util";
import { searchQueryName as imgSearchQueryName } from "../src/scrapers/imagePick";
import { identityCodes, keepableSameProduct } from "../src/scrapers/imagePick";
import { cleanListTitle, cutsMidWord, hasProductSegment, itemPageTitle, looksTruncatedTitle, venueForTitle } from "../src/lib/title";
import { extractSoleJan, isGenericImageUrl, isUnlicensedImageHost, isUsableImageCandidate, pickPageImage, productNameMatches } from "../src/scrapers/imagePick";
import { isRecentPokemonGoods, parseAppearedDate } from "../src/scrapers/pokemonGoods";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import {
  AA_NORMAL,
  contrastHex,
  parseHex,
  readCssHexToken,
  relativeLuminance,
} from "../src/lib/contrast";
import { TAILWIND_TEXT_COLORS, findLowContrastTextClasses } from "../src/lib/textColorLint";

// 観点H用: パレットは**実ファイルから読む**。ここに値をコピーすると、CSSを戻したときに
// 検査だけが古い値で緑を出す（＝「誤りを正解として固定する」型・2026-08-16 に踏んだ）。
const GLOBALS_CSS = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const BRAND_600 = readCssHexToken(GLOBALS_CSS, "color-rose-600");
const BRAND_700 = readCssHexToken(GLOBALS_CSS, "color-rose-700");
const BG_LIGHT = readCssHexToken(GLOBALS_CSS, "background"); // 最初の :root ＝ライト側の地色
const CARD_WHITE = "#ffffff"; // カードは bg-white（ライト時）

/** 小さい文字として AA を満たすか。トークンが読めなければ null（＝素通りさせない）。 */
function aaOnBrand(fg: string | null, bg: string | null): boolean | null {
  if (!fg || !bg) return null;
  const r = contrastHex(fg, bg);
  return r === null ? null : r >= AA_NORMAL;
}

// 実物と同じ並び（記事末尾に通販の商品リンクが来る）を再現した最小の記事HTML。
const EVENT_ARTICLE_HTML =
  '<div id="single__container">' +
  '<p>ウマ娘 × KFC コラボ開催!</p>' +
  '<a href="https://www.kfc.co.jp/campaign/umamusume">公式サイト</a>' +
  '<a href="https://anime-store.jp/products/4934054076093">関連グッズ</a>' +
  "</div>";

const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** 時計lint の呼び出しを短く書くための helper（ファイル名は検査対象になる任意の名前）。 */
const cl = (src: string) => findClockViolations("src/scrapers/example.ts", src);

/** ページ送りlint の呼び出しを短く書くための helper。 */
const gl = (src: string) => findCrawlViolations("src/scrapers/example.ts", src);

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
// 2026-08-18 の実データで検証したケース用（同じく固定）。
const today8_18 = new Date(Date.UTC(2026, 7, 18));

/** 締切日と種別だけを持つ応募先の配列を手早く作る（締切の幅に関する検査用）。 */
const S = (rows: [at: string, kind: "締切" | "開始"][]): StoreEntry[] =>
  rows.map(([at, kind], i) => ({ name: `店${i + 1}`, url: null, form: "抽選", when: at, note: null, at, kind }));
const PAST = "2023年4月発送予定";
const FUTURE = "2027年4月発送予定";
const THIS_MONTH = "2026年8月発送予定"; // 月精度は月末に倒すので「まだ過ぎていない」

/**
 * `rakutenSearchUrl`（＝アフィリのURLを作る関数）を呼んでいるファイルを、ソースを読んで数える。
 * 値ではなく**書き方**を固定する検査なので、実行結果ではなくファイルの中身を見る。
 */
function rakutenAffiliateCallers(): string[] {
  const roots = ["src", "scripts"];
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "generated") continue;
        walk(p);
      } else if (/\.tsx?$/.test(e.name)) {
        if (/\brakutenSearchUrl\s*\(/.test(readFileSync(p, "utf8"))) hits.push(p);
      }
    }
  };
  for (const r of roots) walk(r);
  return hits;
}

/**
 * 免責としてなら書いてよい一文。「転売を推奨しない」と言うには語そのものが要るので、
 * **この文字列に限って**下の走査から除く。増やすときは「語を出すこと自体が目的か」で判断する。
 */
const ALLOWED_FORBIDDEN_PHRASES = [
  "投機や高額転売を推奨するものではありません",
  // 英語版プライバシーポリシーの同じ免責（「推奨しない」と言うには resell の語そのものが要る）。
  "does not encourage speculation or high-priced reselling",
];

/**
 * 表示層のソース1本から「画面に出る文字列に混ざった立ち位置違反の語」を返す（純関数）。
 *
 * コメントは対象外。内部では「せどりの本命」と呼んでよく、表に出さなければよい
 * （[[project_hatsukore_positioning]]）。`//` は `https://` を巻き込まないよう `:` の後は見ない。
 */
export function forbiddenInDisplayText(source: string): string[] {
  let s = source
    .replace(/\/\*[\s\S]*?\*\//g, "") // ブロックコメント（JSXの {/* */} もこれで消える）
    .replace(/(?<!:)\/\/.*$/gm, ""); // 行コメント（URLのスラッシュは除く）
  for (const ok of ALLOWED_FORBIDDEN_PHRASES) s = s.split(ok).join("");
  return findForbidden(s);
}

/** 走査対象＝表示層のソース一覧。 */
function renderLayerSources(): string[] {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "generated") continue;
        walk(p);
      } else if (/\.tsx?$/.test(e.name)) hits.push(p);
    }
  };
  for (const r of ["src/app", "src/components"]) walk(r);
  return hits;
}

/**
 * 表示層の全ファイルを読み、違反語を `ファイル:語` の形で返す。
 *
 * なぜ要るか（2026-08-18 実測）: 語彙は X の下書きだけ `findForbidden` で機械が見ていて、
 * **サイト本体は人の注意だけで守られていた**。実際に3箇所生き残っていた
 * （`/lottery` の description「せどりの本命」＝**検索結果に出る文字列**、item ページの
 * 「二次相場が付きやすい」「転売相場が付きやすい」＝画面本文）。
 * 見た目は何も壊れないので、目視でも描画監査でも永久に見つからない型
 * （[[feedback_hatsukore_facts_must_be_machine_checked]] と同じ理由で、機械に見せる）。
 */
function forbiddenWordsInRenderLayer(): string[] {
  const hits: string[] = [];
  for (const p of renderLayerSources()) {
    for (const w of forbiddenInDisplayText(readFileSync(p, "utf8"))) hits.push(`${p}:${w}`);
  }
  return hits;
}

/** 上のうち、**呼んではいけない場所**（機械が叩く側）だけを返す。 */
function affiliateCallersOutsideRenderLayer(): string[] {
  const allowed = [
    /^src\/lib\/outbound\.ts$/, // 定義そのもの
    /^src\/app\//, // 表示層（クリックするのは人間）
    /^src\/components\//, // 表示層
    /^scripts\/rakutenVerify\.ts$/, // アフィリリンクの着地を確かめるための専用スクリプト
    /^scripts\/auditSelftest\.ts$/, // このファイル（形の固定に使う）
  ];
  return rakutenAffiliateCallers().filter((f) => !allowed.some((re) => re.test(f)));
}

/**
 * 表示層が「元の画像URL」を直接 src に渡していないか（静的スキャン）。
 *
 * 画像は必ず自ドメイン経由（`/i/<商品ID>`）で配る。直リンクに戻すと、画像のホスト名から
 * 収集元が割れる状態（2026-08-18 実測: 表示中1,834枚のうち784枚が収集元ドメイン）に戻るが、
 * **画面は今と1ピクセルも変わらない**ので目視では絶対に気付けない。書き方を固定する。
 */
/** `src={...}` の中身が「元の画像URLをそのまま渡している」形か。
 *  実データを見ずに鳴る側／鳴らない側を固定できるよう、判定だけを関数にしてある。 */
function isDirectImageSrcExpr(expr: string): boolean {
  return /imageUrl|\bp\.image\b/.test(expr) && !/proxiedImageUrl|item\.image\b/.test(expr);
}

/** CardItem 型の本文が、収集元が割れる列（url / imageUrl）を持っているか。 */
function cardItemTypeHasRawUrl(typeSrc: string): boolean {
  return /\burl\s*:|\bimageUrl\s*:/.test(typeSrc);
}

function directImageUrlUsages(): string[] {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.tsx$/.test(e.name)) {
        const src = readFileSync(p, "utf8");
        // src={...imageUrl...} / src={p.image} のような「生のURLをそのまま渡す」書き方。
        for (const m of src.matchAll(/src=\{([^}]*)\}/g)) {
          const expr = m[1];
          if (isDirectImageSrcExpr(expr)) hits.push(`${p}: src={${expr.trim().slice(0, 40)}}`);
        }
      }
    }
  };
  walk("src/app");
  walk("src/components");
  return hits;
}

/**
 * **全文検索から外れる書き方になっているソースが無いか。**
 *
 * 実測 2026-08-19: `scripts/audit.ts`（この企画で最大の検査ファイル）が
 * grep / ripgrep から「バイナリ」と判定され、**中身が1行も引っかからない**状態だった。
 * 原因は文字化け検出の正規表現に**生の制御文字**（NUL 等）をそのまま書いていたこと。
 * 動作は正しいので誰も気付かないが、「検索して数える」作業が静かに空振りする
 * （＝この企画がいちばん頼りにしている調べ方が壊れる）。
 * 併せて BOM も見る（BOM付きは差分・連結・シェルの扱いで事故りやすい）。
 *
 * 制御文字を扱いたいときは `\u0000` のようなエスケープで書けばよい（意味は同じ）。
 */
function unsearchableSourceFiles(): string[] {
  const bad: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === "generated" || e.name === "node_modules") continue;
        walk(p);
      } else if (/\.(?:ts|tsx|css|json|md)$/.test(e.name)) {
        const buf = readFileSync(p);
        if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) bad.push(`${p}: BOM付き`);
        const ctrl = [...buf].filter(
          (b) => b < 0x09 || b === 0x0b || b === 0x0c || (b >= 0x0e && b <= 0x1f)
        );
        if (ctrl.length) bad.push(`${p}: 生の制御文字が${ctrl.length}個（grep がバイナリ扱いする）`);
      }
    }
  };
  walk("src");
  walk("scripts");
  return bad;
}

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

  // ── 文章から暦日を取り出す（date_text_mismatch と audit:facts の日付突合の土台） ──────
  // 2026-08-19 実測: 収集元の見出しが `id="20260904"` を 9/4・9/11・9/18 の3つで使い回しており、
  // id を信じていた 23件が本番で「9/4(金)」と「2026年09月18日登場予定」を同時に表示していた。
  // 鳴る側と、**誤報しやすい表記で鳴らない側**の両方を固定する。
  { name: "年付きの日付を取り出す", fn: () => extractDates("2026年09月18日登場予定").map((d) => `${d.year}-${d.month}-${d.day}`).join(","), want: "2026-9-18" },
  { name: "全角の日付も取り出す", fn: () => extractDates("８月２１日（金）").map((d) => `${d.month}/${d.day}`).join(","), want: "8/21" },
  { name: "期間は両端とも取り出す", fn: () => extractDates("2026年8月19日〜10月20日").map((d) => `${d.month}/${d.day}`).join(","), want: "8/19,10/20" },
  // 「それらしく読めてしまう」表記ほど誤報になる（過去に週表記を8月5日と読んで93件誤報した）。
  { name: "週表記から日付を作らない", fn: () => extractDates("2026年08月05週登場予定").length, want: 0 },
  { name: "上旬・下旬から日付を作らない", fn: () => extractDates("2026年09月上旬").length, want: 0 },
  { name: "月精度の文言から日付を作らない", fn: () => extractDates("2026年9月発送予定").length, want: 0 },
  { name: "スケール表記を日付と読まない", fn: () => extractDates("1/144スケール ガンダム").length, want: 0 },
  // 年付きの日付を「年の無い日付」として二度拾うと、年だけ違う日付が一致扱いになる。
  { name: "年だけ違う日付は食い違いとして鳴る", fn: () => dateTextConflict(new Date(Date.UTC(2027, 7, 19)), "2026年8月19日") !== null, want: true },
  { name: "日付が文言と一致していれば鳴らない", fn: () => dateTextConflict(new Date(Date.UTC(2026, 8, 18)), "2026年09月18日登場予定"), want: null },
  { name: "日付が文言と食い違えば鳴る", fn: () => dateTextConflict(new Date(Date.UTC(2026, 8, 4)), "2026年09月18日登場予定") !== null, want: true },
  { name: "期間のどちらの端でも一致とみなす", fn: () => dateTextConflict(new Date(Date.UTC(2026, 9, 20)), "2026年8月19日〜10月20日"), want: null },
  { name: "暦日が書かれていない文言は判定しない", fn: () => dateTextConflict(new Date(Date.UTC(2026, 8, 1)), "2026年09月上旬"), want: null },
  // 収集元の見出しは**文言**で読む（id 属性は収集元の内部都合で、使い回されていた）。
  { name: "見出しの文言から日付を作る", fn: () => ymd(parseFigislandHeadingDate("2026年09月18日登場予定")), want: "2026-09-18" },
  { name: "日が公表されていない見出しは日付を作らない", fn: () => parseFigislandHeadingDate("2026年09月02週登場予定"), want: null },
  { name: "月だけの見出しも日付を作らない", fn: () => parseFigislandHeadingDate("2026年09月登場予定"), want: null },
  // 受付期間は応募ページ側を正とする（一覧カードは「08月31日 23:59 まで」＝9時間手前を指していた）。
  {
    name: "応募ページの受付期間から締切日を採る",
    fn: () => ymd(extractRafflePeriod('<div>2026年08月19日 03:00 ~ 2026年09月01日 08:59</div>')?.end ?? null),
    want: "2026-09-01",
  },
  {
    name: "受付期間は収集元の文言のまま持つ",
    fn: () => extractRafflePeriod('<div>2026年08月19日 03:00 ~ 2026年09月01日 08:59</div>')?.text,
    want: "2026年08月19日 03:00 ~ 2026年09月01日 08:59",
  },
  { name: "期間が書かれていなければ作らない", fn: () => extractRafflePeriod("<div>受付中</div>"), want: null },
  // 同名・別日付が並ぶと、日付がどちらのものか読者に決められない（実測: ナイキ ブレイジー 2件）。
  {
    name: "同名が並んだら品番で区別する",
    fn: () =>
      disambiguateSameTitle([
        { source: "nike_snkrs", sourceId: "IM2523-001", title: "ナイキ ブレイジー", genre: "スニーカー", subGenre: null, eventType: "発売", eventDate: null, eventDateText: null, price: null, url: "u1", imageUrl: null },
        { source: "nike_snkrs", sourceId: "IM2523-100", title: "ナイキ ブレイジー", genre: "スニーカー", subGenre: null, eventType: "発売", eventDate: null, eventDateText: null, price: null, url: "u2", imageUrl: null },
      ]).map((i) => i.title).join(" / "),
    want: "ナイキ ブレイジー（IM2523-001） / ナイキ ブレイジー（IM2523-100）",
  },
  {
    name: "重なっていない商品名は触らない",
    fn: () =>
      disambiguateSameTitle([
        { source: "nike_snkrs", sourceId: "IM2523-001", title: "ナイキ ブレイジー", genre: "スニーカー", subGenre: null, eventType: "発売", eventDate: null, eventDateText: null, price: null, url: "u1", imageUrl: null },
        { source: "nike_snkrs", sourceId: "HF1234-001", title: "ナイキ ダンク", genre: "スニーカー", subGenre: null, eventType: "発売", eventDate: null, eventDateText: null, price: null, url: "u2", imageUrl: null },
      ]).map((i) => i.title).join(" / "),
    want: "ナイキ ブレイジー / ナイキ ダンク",
  },

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
    // 販売単位の重複解消で畳まれた行も「商品はまだページにある」＝説明済み（2026-08-18）。
    // 畳む側（dedupeSaleUnitSameSource）と説明する側で同じ物差しを使う。
    name: "販売単位で畳まれた行は『説明済み』",
    fn: () => {
      const rep = { source: "torecasoku", title: "ブースターパック 葬送のフリーレン Vol.2", eventDate: new Date(Date.UTC(2026, 7, 28)) };
      const box = { id: 1, inDb: true, source: rep.source, title: `${rep.title} 【10パック入りBOX】`, eventDate: rep.eventDate };
      return classifyPageLoss("/tcg/ヴァイス", [box], today, new Set(productMergeKeys(rep, true))).merged;
    },
    want: 1,
  },
  {
    // 単位表記を持たない行の消失は、名前が似ていても「畳まれた」で説明しない。
    name: "単位表記の無い行の消失は説明済みにしない",
    fn: () => {
      const rep = { source: "torecasoku", title: "ブースターパック 葬送のフリーレン Vol.2", eventDate: new Date(Date.UTC(2026, 7, 28)) };
      const other = { id: 2, inDb: true, source: rep.source, title: rep.title, eventDate: rep.eventDate };
      return classifyPageLoss("/tcg/ヴァイス", [other], today, new Set(productMergeKeys(rep, true))).unexplained.length;
    },
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
  // 同一ソース・同一表示名のまとめ記事は読む側に区別がつかない（2026-08-18）。
  // 残すのは「応募先の件数が多い方」ではなく「今日にいちばん近い動きがある方」＝実データで検証済み。
  {
    name: "同名まとめ: 直近に動いている方を残す（件数が多い古いハブを残さない）",
    fn: () => {
      const mk = (id: number, dates: string[]) => ({
        id,
        source: "nyuka_now",
        title: "ONE PIECE カードゲーム",
        url: null,
        eventDate: null,
        price: null,
        imageUrl: null,
        stores: JSON.stringify(dates.map((at) => ({ name: `店${at}`, url: null, form: "抽選", when: `${at}〜`, note: null, at, kind: "開始" }))),
      });
      const kept = dedupeSameSourceSameName([mk(1, ["2026-08-15", "2026-08-07"]), mk(2, ["2026-06-16", "2026-05-01", "2026-05-08", "2026-03-29"])], today8_18);
      return kept.map((r) => r.id).join(",");
    },
    want: "1",
  },
  {
    name: "同名まとめ: 名前が違えば畳まない",
    fn: () => {
      const mk = (id: number, title: string) => ({
        id, source: "nyuka_now", title, url: null, eventDate: null, price: null, imageUrl: null,
        stores: JSON.stringify([{ name: "店", url: null, form: "抽選", when: "8/15〜", note: null, at: "2026-08-15", kind: "開始" }]),
      });
      return dedupeSameSourceSameName([mk(1, "ポケモンカード メガブレイブ"), mk(2, "ポケモンカード メガシンフォニア")], today8_18).length;
    },
    want: 2,
  },
  {
    name: "同名まとめ: stores を持たない通常の商品行は触らない",
    fn: () => {
      const mk = (id: number) => ({ id, source: "figisland", title: "同じ名前のフィギュア", url: null, eventDate: null, price: null, imageUrl: null, stores: null });
      return dedupeSameSourceSameName([mk(1), mk(2)], today8_18).length;
    },
    want: 2,
  },
  {
    name: "同名まとめ: 収集元が違えば触らない（クロスソースは別の検査の仕事）",
    fn: () => {
      const mk = (id: number, source: string) => ({
        id, source, title: "ONE PIECE カードゲーム", url: null, eventDate: null, price: null, imageUrl: null,
        stores: JSON.stringify([{ name: "店", url: null, form: "抽選", when: "8/15〜", note: null, at: "2026-08-15", kind: "開始" }]),
      });
      return dedupeSameSourceSameName([mk(1, "nyuka_now"), mk(2, "card_chusen")], today8_18).length;
    },
    want: 2,
  },

  // 収集元のまとめ記事タイトル → 商品名（2026-08-18: 巡回範囲を広げたら書式が違う記事が届いた）
  { name: "まとめ記事: 新しい書式（抽選予約・先着販売・…情報まとめ）から商品名を取り出す", fn: () => cleanProductName("【2026年8月17日更新】ポケモンカード メガブレイブの抽選予約・先着販売・在庫あり・再販入荷情報まとめ"), want: "ポケモンカード メガブレイブ" },
  { name: "まとめ記事: 旧書式（各種の抽選・予約情報まとめ）も従来どおり", fn: () => cleanProductName("【2026年8月18日更新】POP MART LABUBU ラブブ各種の抽選・予約情報まとめ"), want: "POP MART LABUBU ラブブ" },
  { name: "まとめ記事: 「まとめ」で終わらない見出しは商品名を削らない", fn: () => cleanProductName("【更新】ポケモンカード メガブレイブの抽選予約はこちら"), want: "ポケモンカード メガブレイブの抽選予約はこちら" },
  { name: "まとめ記事: 更新日の【】だけの見出しでも壊れない", fn: () => cleanProductName("【2026年8月17日更新】Nintendo Switch 2の抽選予約・先着販売・在庫あり・再販入荷情報まとめ"), want: "Nintendo Switch 2" },

  // ページ間の移動は消失ではない（2026-08-18 実測: 受付中ストアが増えて最も近い日が
  // 11月→8/18に変わり、/release/2026-11 から /release/2026-08 へ移った3件が
  // 「説明のつかない消失」で ERROR を出していた。データは1件も失われていない）。
  {
    name: "別ページへ移った行は消失ではない（移動として数える）",
    fn: () =>
      classifyPageLoss(
        "/release/2026-11",
        [{ id: 7, inDb: true, eventDate: new Date(Date.UTC(2026, 7, 18)) }],
        today,
        undefined,
        new Set([7])
      ).moved,
    want: 1,
  },
  {
    name: "サイトのどこにも出ていない行は、移動にせず説明なしのまま（鳴る側）",
    fn: () =>
      classifyPageLoss(
        "/release/2026-11",
        [{ id: 7, inDb: true, eventDate: new Date(Date.UTC(2026, 10, 20)) }],
        today,
        undefined,
        new Set([99])
      ).unexplained.length,
    want: 1,
  },
  {
    name: "移動の判定は、収集元から消えた理由を覆い隠さない",
    fn: () =>
      classifyPageLoss("/genre/トレカ", [{ id: 7, inDb: false, eventDate: null }], today, undefined, new Set([7])).gone,
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

  // (b-1b) 「抽選日」は**抽選が行われる日**と読める。実体は応募締切であることが多い
  //        （実測 2026-08-19: カーナベルの「〜8/21 23:59」＝応募締切を「抽選日 8月21日」と
  //        表示していた。掲載2183件中125件がこの見出し）。実データで決まるときだけ言い切る。
  {
    name: "抽選: 同じ日の応募先が『締切』なら見出しは『応募締切』",
    fn: () =>
      eventDateHeading("抽選", null, false, {
        source: "card_chusen",
        eventDate: new Date("2026-08-21T00:00:00.000Z"),
        stores: JSON.stringify([
          { name: "カーナベル", url: "https://example.test/", form: "抽選", when: "〜8/21 23:59", at: "2026-08-21", kind: "締切" },
        ]),
      }),
    want: "応募締切",
  },
  {
    name: "抽選: 同じ日の応募先が『開始』だけなら『受付開始』",
    fn: () =>
      eventDateHeading("抽選", null, false, {
        source: "nyuka_now",
        eventDate: new Date("2026-08-21T00:00:00.000Z"),
        stores: JSON.stringify([
          { name: "店A", url: "https://example.test/", form: "抽選", when: "8/21 10:00〜", at: "2026-08-21", kind: "開始" },
        ]),
      }),
    want: "受付開始",
  },
  {
    name: "抽選: 応募先が無くても、収集元の実装で締切と決まっていれば『応募締切』",
    fn: () =>
      eventDateHeading("抽選", null, false, {
        source: "raffle_kuji",
        eventDate: new Date("2026-08-24T00:00:00.000Z"),
        stores: null,
      }),
    want: "応募締切",
  },
  {
    // channeltono はタイトルに出た最初の「M月D日」を拾うだけ＝何の日かは分からない。
    // 分からないものを「抽選日」と断定しない（[[UIラベルは裏取り済みのみ約束]]）。
    name: "抽選: 日付の意味が確かめられない収集元は『抽選日』と断定しない",
    fn: () =>
      eventDateHeading("抽選", null, false, {
        source: "channeltono",
        eventDate: new Date("2026-08-25T00:00:00.000Z"),
        stores: null,
      }),
    want: "告知の日付",
  },
  {
    // nike_snkrs の eventDate はカレンダーの抽選/発売日そのもの（締切は eventDateText 側）。
    // ここまで一律に「応募締切」と書き換えると、今度は逆向きの嘘になる。
    name: "抽選: eventDate が本当に抽選日の収集元は『抽選日』のまま",
    fn: () =>
      eventDateHeading("抽選", "抽選応募締切 8/20 23:59", false, {
        source: "nike_snkrs",
        eventDate: new Date("2026-08-22T00:00:00.000Z"),
        stores: null,
      }),
    want: "抽選日",
  },
  {
    name: "抽選: 材料を渡さなければ従来どおり（呼び出し漏れで文言が勝手に変わらない）",
    fn: () => eventDateHeading("抽選", null, false),
    want: "抽選日",
  },

  // (b-1c) 応募先リンクの選び方。巡回時と表示時で**同じ関数**を使う。
  //        実測 2026-08-19: item.url は巡回時に「締切が近い順の先頭」で決まるので、
  //        日が経つと締切済みの店を指す（掲載中の抽選5件。#75419 は8/18に終了した店だった）。
  {
    name: "応募先: 店舗ドメインをフォーム・Xより優先する",
    fn: () =>
      preferredStoreUrl([
        { name: "X告知", url: "https://x.com/shop/status/1", form: null, when: null, note: null, at: null, kind: null },
        { name: "フォーム", url: "https://docs.google.com/forms/d/e/abc/viewform", form: null, when: null, note: null, at: null, kind: null },
        { name: "店", url: "https://shop.example/lottery", form: null, when: null, note: null, at: null, kind: null },
      ]),
    want: "https://shop.example/lottery",
  },
  {
    name: "応募先: 店舗ドメインが無ければフォーム（Xは最後）",
    fn: () =>
      preferredStoreUrl([
        { name: "X告知", url: "https://x.com/shop/status/1", form: null, when: null, note: null, at: null, kind: null },
        { name: "フォーム", url: "https://docs.google.com/forms/d/e/abc/viewform", form: null, when: null, note: null, at: null, kind: null },
      ]),
    want: "https://docs.google.com/forms/d/e/abc/viewform",
  },
  {
    name: "応募先: 締切済みの店を除いてから選べば、生きている店が出る",
    fn: () => {
      const stores = [
        { name: "締切済みの店", url: "https://closed.example/", form: null, when: "〜8/18 23:59", note: null, at: "2026-08-18", kind: "締切" },
        { name: "受付中の店", url: "https://open.example/", form: null, when: "〜8/25 23:59", note: null, at: "2026-08-25", kind: "締切" },
      ] as StoreEntry[];
      const { open } = splitStoresByDeadline(stores, new Date("2026-08-19T00:00:00.000Z"));
      return preferredStoreUrl(open);
    },
    want: "https://open.example/",
  },

  // (b-2) 日付が過ぎたら見出しも「予定」と書かない。バッジ（displayEventType）は
  //       「登場済み」に倒れるのに見出しだけ「登場予定」のままだと、同じページで矛盾する。
  //       実測 2026-08-18: sitemap掲載 2846件中 222件がこの状態だった。
  {
    name: "登場予定・過去 → 見出しは『登場日』（バッジの登場済みと矛盾しない）",
    fn: () => eventDateHeading("登場予定", null, true),
    want: "登場日",
  },
  {
    name: "登場予定・未来 → 見出しは『登場予定』のまま",
    fn: () => eventDateHeading("登場予定", null, false),
    want: "登場予定",
  },
  // (b-3) X投稿の断定語は行の実データから導出する。**見出しに種別を書けるのは全行一致のときだけ。**
  //       本人がレビューしても誤りを検出できない領域なので、ここは機械で固定する
  //       （実測 2026-08-18: 「本日の発売予定」と書こうとした5件のうち eventType=発売 は1件だけだった）。
  {
    name: "投稿: 種別が全行そろえば見出しに畳み、行からは消す",
    fn: () =>
      buildPost({
        rows: [
          { name: "商品A", type: "抽選", dateLabel: "8/18(火)" },
          { name: "商品B", type: "抽選", dateLabel: "8/18(火)" },
        ] as DraftRow[],
        headBase: "今日の予定",
        tail: "→ https://hatsukore.com/",
        weigh: (t: string) => t.length,
        budget: 500,
      }).text,
    want: ["【抽選】8/18(火)", "", "・商品A", "・商品B", "", "→ https://hatsukore.com/"].join(LF),
  },
  {
    name: "投稿: 種別が混在したら見出しに種別を書かず、行ごとに出す",
    fn: () =>
      buildPost({
        rows: [
          { name: "商品A", type: "抽選", dateLabel: "8/18(火)" },
          { name: "商品B", type: "開催", dateLabel: "8/18(火)" },
        ] as DraftRow[],
        headBase: "今日の予定",
        tail: "→ https://hatsukore.com/",
        weigh: (t: string) => t.length,
        budget: 500,
      }).text,
    want: ["【今日の予定】8/18(火)", "", "・抽選 商品A", "・開催 商品B", "", "→ https://hatsukore.com/"].join(LF),
  },
  {
    name: "投稿: 日付が混在したら行頭に日付を残す（日付なしは収集元の文言）",
    fn: () =>
      buildPost({
        rows: [
          { name: "商品A", type: "抽選", dateLabel: "8/18(火)" },
          { name: "商品B", type: "抽選", dateLabel: null, noDateLabel: "受付中" },
        ] as DraftRow[],
        headBase: "今日の予定",
        tail: "→ x",
        weigh: (t: string) => t.length,
        budget: 500,
      }).text,
    want: ["【抽選】", "", "・8/18(火) 商品A", "・受付中 商品B", "", "→ x"].join(LF),
  },
  // 🚨 2026-08-19 実測: 日付が無い行を機械が「受付中」で埋めていて、
  //    `eventDateText="受付終了（直近 7/1）"`＝もう応募できない商品を
  //    「受付中 ニッカウイスキー竹鶴」と書いていた。**日付が無い＝受付中ではない。**
  {
    name: "投稿: 日付も収集元の文言も無い行は載せない（受付中を勝手に書かない）",
    fn: () =>
      buildPost({
        rows: [
          { name: "商品A", type: "抽選", dateLabel: "8/18(火)" },
          { name: "商品B", type: "抽選", dateLabel: null },
        ] as DraftRow[],
        headBase: "今日の予定",
        tail: "→ x",
        weigh: (t: string) => t.length,
        budget: 500,
      }).text,
    want: ["【抽選】8/18(火)", "", "・商品A", "", "→ x"].join(LF),
  },
  {
    name: "投稿: 受付終了の文言はそのまま出る（受付中に化けない）",
    fn: () =>
      buildPost({
        rows: [
          { name: "商品A", type: "抽選", dateLabel: "8/18(火)" },
          { name: "竹鶴", type: "抽選", dateLabel: null, noDateLabel: "受付終了（直近 7/1）" },
        ] as DraftRow[],
        headBase: "今日の予定",
        tail: "→ x",
        weigh: (t: string) => t.length,
        budget: 500,
      }).text,
    want: ["【抽選】", "", "・8/18(火) 商品A", "・受付終了（直近 7/1） 竹鶴", "", "→ x"].join(LF),
  },
  {
    name: "投稿: 見出しに足す語（応募受付中）は【】の後ろに出る",
    fn: () =>
      buildPost({
        rows: [
          { name: "商品A", type: "抽選", dateLabel: "〜8/19(水)" },
          { name: "商品B", type: "抽選", dateLabel: "〜8/24(月)" },
        ] as DraftRow[],
        headBase: "抽選",
        headNote: "応募受付中",
        tail: "→ x",
        weigh: (t: string) => t.length,
        budget: 500,
      }).text,
    want: ["【抽選】応募受付中", "", "・〜8/19(水) 商品A", "・〜8/24(月) 商品B", "", "→ x"].join(LF),
  },
  {
    name: "投稿: 予算で落ちた行の種別は見出し判定に混ぜない",
    fn: () =>
      buildPost({
        rows: [
          { name: "A", type: "抽選", dateLabel: "8/18(火)" },
          { name: "B", type: "抽選", dateLabel: "8/18(火)" },
          // 3行目は予算に入らない。ここの「開催」を拾って見出しを崩してはいけない
          { name: "とても長い商品名とても長い商品名とても長い商品名", type: "開催", dateLabel: "8/18(火)" },
        ] as DraftRow[],
        headBase: "今日の予定",
        tail: "→ x",
        weigh: (t: string) => t.length,
        budget: 60,
      }).text,
    want: ["【抽選】8/18(火)", "", "・A", "・B", "", "→ x"].join(LF),
  },
  {
    name: "投稿: 立ち位置に反する語を機械で拾う",
    fn: () => findForbidden("この商品は相場が高騰していて利益が出ます").join(","),
    want: "転売,利益,高騰,相場".split(",").filter((w) => "この商品は相場が高騰していて利益が出ます".includes(w)).join(","),
  },
  {
    name: "投稿: 通常の本文は禁止語に引っかからない",
    fn: () => findForbidden("【抽選】8/18(火) ・NIKE MIND 001").length,
    want: 0,
  },
  // (b-4) 本文に書いた「数」の腐り（2026-08-19 実測）。8/18に手で書いた告知が
  //       `2,139件` `26の情報源` のまま残り、実データは `1,873件` `24` になっていた。
  //       数は書いた瞬間から腐るのに、本人にもレビュアーにも誤りが見えない。
  {
    name: "数: 古い件数を拾う（実データに無い数は通さない）",
    fn: () =>
      findStaleNumbers("いま掲載 2,139件", { 件: [1873, 225, 103], 収集元: [24], ジャンル: [15] }).length,
    want: 1,
  },
  {
    name: "数: 実データと一致する件数は通す（桁区切りありでも）",
    fn: () =>
      findStaleNumbers("いま掲載 1,873件", { 件: [1873, 225, 103], 収集元: [24], ジャンル: [15] }).length,
    want: 0,
  },
  {
    name: "数: 同じ単位なら別の候補（今後7日）と一致してもよい",
    fn: () =>
      findStaleNumbers("予定が225件あります", { 件: [1873, 225, 103], 収集元: [24], ジャンル: [15] }).length,
    want: 0,
  },
  {
    name: "数: 収集元の数は件数の候補では通らない（単位ごとに突き合わせる）",
    fn: () =>
      findStaleNumbers("26の情報源から集めて", { 件: [1873, 26, 103], 収集元: [24], ジャンル: [15] }).length,
    want: 1,
  },
  {
    name: "数: 単位の無い数（日付・URL・商品名）は主張として拾わない",
    fn: () => findNumberClaims("8/19(水) ポケカ 30th BOX https://hatsukore.com/items/92479").length,
    want: 0,
  },
  {
    name: "告知: 数は facts から入る（文面に手書きの数が残っていない）",
    fn: () =>
      buildLaunchPosts({ items: 1873, sources: 24, within7: 225, site: "https://hatsukore.com" })
        .map((p) => findStaleNumbers(p.text, { 件: [1873, 225, 103], 収集元: [24], ジャンル: [15] }).length)
        .reduce((a, b) => a + b, 0),
    want: 0,
  },
  {
    name: "告知: facts を変えると本文の数も変わる（定数が焼き付いていない）",
    fn: () =>
      buildLaunchPosts({ items: 42, sources: 7, within7: 3, site: "https://hatsukore.com" })
        .map((p) => findStaleNumbers(p.text, { 件: [42, 3], 収集元: [7], ジャンル: [1] }).length)
        .reduce((a, b) => a + b, 0),
    want: 0,
  },
  {
    name: "告知: 立ち位置に反する語が入っていない",
    fn: () =>
      buildLaunchPosts({ items: 1873, sources: 24, within7: 225, site: "https://hatsukore.com" })
        .map((p) => findForbidden(p.text).length)
        .reduce((a, b) => a + b, 0),
    want: 0,
  },
  // ── 表示層の語彙（静的スキャン・2026-08-18） ──────────────
  // 「健全路線にした」つもりで3箇所が外に出ていた実測から。以下4件は
  // ①判定そのもの ②コメントは見逃す ③免責は通す ④走査が空振りしていない を固定する。
  {
    name: "表示語彙: 画面に出る文字列の違反語を拾う",
    fn: () => forbiddenInDisplayText(`const D = "当選＝定価入手＝せどりの本命";`).join(","),
    want: "せどり",
  },
  {
    name: "表示語彙: コメントの中は見逃す（内部ではその語で呼んでよい）",
    fn: () => forbiddenInDisplayText(`// 高額品＝せどりの本命\n{/* 転売相場が付く */}\nconst a = 1;`).length,
    want: 0,
  },
  {
    name: "表示語彙: 免責の一文は通す（転売を推奨しないと書くには語が要る）",
    fn: () => forbiddenInDisplayText(`<p>投機や高額転売を推奨するものではありません。</p>`).length,
    want: 0,
  },
  {
    name: "表示語彙: URLのスラッシュをコメントと誤読しない",
    fn: () => forbiddenInDisplayText(`<a href="https://x.com/">相場</a>`).join(","),
    want: "相場",
  },
  {
    name: "表示層に立ち位置に反する語が出ていない",
    fn: () => forbiddenWordsInRenderLayer().join(" / "),
    want: "",
  },
  {
    name: "静的スキャン自体が空振りしていない（表示層のファイルが見えている）",
    fn: () => renderLayerSources().length >= 15,
    want: true,
  },
  {
    name: "過去でも『発送予定』は据え置き（発送月は予定のままが正しい）",
    fn: () => eventDateHeading("予約", "2026年10月発送予定", true),
    want: "発送予定",
  },
  {
    name: "バッジと見出しが同じ過去判定を使う（登場予定・過去）",
    fn: () => displayEventType("登場予定", null, PAST, today),
    want: "登場済み",
  },

  // (c) プレバンの発送月が過ぎたら「予約」→「予約終了」（受付中と断定しない新ラベルでも効く）
  { name: "予約・過去 → 表示が予約終了", fn: () => displayEventType("予約", null, PAST, today), want: "予約終了" },
  { name: "予約・未来 → そのまま", fn: () => displayEventType("予約", null, FUTURE, today), want: "予約" },
  { name: "予約・過去 → 検査は鳴らない（表示層で直しているため）", fn: () => isStalePromise("予約", null, PAST, today), want: false },

  // (d) 買いに行ける場所のラベル。販売店名は裏取り済みの事実なので約束してよいが、
  //     受付中かどうかは確認できていないので「予約する」とは書かない。
  { name: "プレバンは店名を出す", fn: () => officialUrlLabel(null, "figisland_pb"), want: "プレミアムバンダイで見る →" },
  { name: "受付状況は約束しない（『予約する』と書かない）", fn: () => /予約する/.test(officialUrlLabel(null, "figisland_pb")), want: false },
  { name: "販売内容が裏取りできない時は公式ページ止まり", fn: () => officialUrlLabel(null), want: "公式ページを見る →" },

  // (d-2) 楽天アフィリンク。**壊れても画面上は正常に見える**（リンクは楽天に飛ぶので
  // 押した人も自分も気づかず、成果だけが静かに落ちる）ため、ここで形を固定する。
  {
    name: "アフィリIDが無ければ素の検索URL",
    fn: () => rakutenSearchUrl("ポケカ 拡張パック", ""),
    want: "https://search.rakuten.co.jp/search/mall/%E3%83%9D%E3%82%B1%E3%82%AB%20%E6%8B%A1%E5%BC%B5%E3%83%91%E3%83%83%E3%82%AF/",
  },
  {
    name: "形が違うIDは使わない（成果の付かないリンクを作らない）",
    fn: () => rakutenSearchUrl("ポケカ", "not-an-id").startsWith("https://search.rakuten.co.jp/"),
    want: true,
  },
  {
    name: "正しい形のIDならアフィリ経由に包む",
    fn: () => rakutenSearchUrl("ポケカ", "1a2b3c4d.5e6f7g8h.9i0j1k2l.3m4n5o6p").startsWith("https://hb.afl.rakuten.co.jp/hgc/1a2b3c4d.5e6f7g8h.9i0j1k2l.3m4n5o6p/?pc="),
    want: true,
  },
  {
    // pc= に渡す内側URLは**二重エンコード**になる（内側で既に日本語が %XX 化されていて、
    // それを更に encodeURIComponent で包むため % が %25 になる）。これは正しい姿で、
    // 包まないと内側の & や = がパラメータ境界と誤読されて着地先が壊れる。
    name: "アフィリ経由でも検索語は保たれる（2回デコードで戻る）",
    fn: () =>
      decodeURIComponent(
        decodeURIComponent(rakutenSearchUrl("ポケカ", "1a2b3c4d.5e6f7g8h.9i0j1k2l.3m4n5o6p"))
      ).includes("search.rakuten.co.jp/search/mall/ポケカ/"),
    want: true,
  },
  // (d-2b) **機械が叩く側でアフィリURLを作っていないか**（静的スキャン・2026-08-18）。
  //
  // アフィリのURLは踏むとクリックが記録される。巡回・画像収集・スクレイパーがこれを作ると、
  // 保存した先や fetch でそのまま踏まれ、**成果ゼロのクリックだけが毎日自分のIDに積み上がる**
  // ＝楽天の禁止事項（自己クリック・不正クリック）。実測 2026-08-18 に2経路がこの形だった
  // （scripts/backfillImages.ts の画像探索と、gunpla_resale / sofvi が保存する item.url）。
  // 直した後に**元の書き方へ戻っても画面は何も変わらない**ので、値ではなく書き方を固定する。
  // 表示層(src/app, src/components)と outbound.ts 自身、検証用の rakutenVerify だけが呼んでよい。
  {
    name: "巡回・スクレイパーは楽天アフィリURLを作らない（自分のリンクを機械で叩かない）",
    fn: () => affiliateCallersOutsideRenderLayer().join(" / "),
    want: "",
  },
  {
    name: "静的スキャン自体が空振りしていない（表示層の呼び出しは見えている）",
    fn: () => rakutenAffiliateCallers().some((f) => f.startsWith("src/app/")),
    want: true,
  },
  // (d-2e) 掲載根拠の無いホスト（Amazonの商品画像。アソシエイト未加入なので借りる根拠が無い）。
  { name: "画像: Amazonの商品画像は採らない", fn: () => isUnlicensedImageHost("https://m.media-amazon.com/images/I/71abc.jpg"), want: true },
  { name: "画像: 楽天の商品画像はこの判定では落とさない", fn: () => isUnlicensedImageHost("https://thumbnail.image.rakuten.co.jp/@0_mall/x.jpg"), want: false },
  { name: "画像: 候補判定でもAmazonは弾く", fn: () => isUsableImageCandidate("https://m.media-amazon.com/images/I/71abc.jpg"), want: false },
  // (d-2d) トラッキングは # の中にも入る。実測 #93668 の形（収集元名がフラグメントに残っていた）。
  {
    name: "公式リンク: フラグメント内のトラッキングも落とす（収集元名を配らない）",
    fn: () => cleanStoreUrl("https://eeo.today/pr/seiken-so-ikebukuro/#so?utm_source=collabo_cafe_dot_com&utm_medium=x"),
    want: "https://eeo.today/pr/seiken-so-ikebukuro/#so",
  },
  {
    name: "公式リンク: 意味のあるアンカーは残す",
    fn: () => cleanStoreUrl("https://example.com/page#section"),
    want: "https://example.com/page#section",
  },
  // (d-2c) 画像は自ドメイン経由でしか出さない（収集元のホスト名をHTMLに出さないため）。
  {
    name: "表示層は元の画像URLを直接 src に渡さない（収集元が割れる直リンクに戻さない）",
    fn: () => directImageUrlUsages().join(" / "),
    want: "",
  },
  {
    name: "カードに渡す形は url / imageUrl を持てない（型で塞ぐ）",
    fn: () => {
      const src = readFileSync("src/lib/cardItem.ts", "utf8");
      const type = src.slice(src.indexOf("export type CardItem"), src.indexOf("export function toCardItem"));
      return cardItemTypeHasRawUrl(type);
    },
    want: false,
  },
  // ↑の2つは「本物のファイルを見て0件」なので、**検査が壊れていても同じ結果になる**。
  // 実測 2026-08-19: この2つの単語境界が**生のバックスペース文字**になっていて、
  // CardItem 側は何を書いても一致しない＝**永久に鳴らない検査**だった（画面は正常なまま）。
  // 鳴る側を合成データで固定して、空振りしていないことを示す。
  { name: "検査が生きている: CardItem に url を足したら鳴る", fn: () => cardItemTypeHasRawUrl("  id: number;\n  url: string;"), want: true },
  { name: "検査が生きている: CardItem の imageUrl も鳴る", fn: () => cardItemTypeHasRawUrl("  imageUrl: string | null;"), want: true },
  { name: "検査が生きている: 似た名前（sourceUrlKey）では鳴らない", fn: () => cardItemTypeHasRawUrl("  sourceUrlKey: string;"), want: false },
  { name: "検査が生きている: 生の imageUrl を src に渡したら鳴る", fn: () => isDirectImageSrcExpr("item.imageUrl ?? undefined"), want: true },
  { name: "検査が生きている: 各賞の p.image を直に渡したら鳴る", fn: () => isDirectImageSrcExpr("p.image"), want: true },
  { name: "検査が生きている: プロキシ経由なら鳴らない", fn: () => isDirectImageSrcExpr("item.image"), want: false },
  { name: "IDの形（4ブロック）を認める", fn: () => isRakutenAffiliateId("1a2b3c4d.5e6f7g8h.9i0j1k2l.3m4n5o6p"), want: true },
  { name: "IDの形（3ブロック）は認めない", fn: () => isRakutenAffiliateId("1a2b3c4d.5e6f7g8h.9i0j1k2l"), want: false },
  // 以下2件は「楽天のリンク作成ツールが実際に吐いたリンク」から写した形（2026-08-18実測）。
  // 仕様が公開されていないので、実物と違う形に戻したら気づけるようにここで固定する。

  // (d-3) 会場つきタイトル。Search Console の実測で、付いている検索需要は
  // 「コラボ・ポップアップ × 地名/店舗」だった（「ナガノマーケット 仙台」91表示・クリック0）。
  // 会場と期間を出す代わりに、**切ると嘘になる形は載せない**を機械で固定する。
  {
    name: "会場: 単一の会場名は載せる",
    fn: () => venueForTitle([{ name: "渋谷モディ 7F" }], "約ネバ 10周年 ポップアップストア in 渋谷"),
    want: "渋谷モディ 7F",
  },
  {
    name: "会場: 地図リンクの行は飛ばして次を見る",
    fn: () =>
      venueForTitle(
        [{ name: "Googleマップ で見る" }, { name: "JR仙台駅 2階 ステンドグラス前催事場" }],
        "ナガノマーケット ポップアップストア in 仙台駅"
      ),
    want: "JR仙台駅 2階 ステンドグラス前催事場",
  },
  {
    name: "会場: 複数店の羅列は載せない（切ると開催してない店でやってると読める）",
    fn: () =>
      venueForTitle(
        [{ name: "スイーツパラダイス 新宿東口店、天王寺ミオ店、横浜ビブレ店、名古屋パルコ店" }],
        "ハイキュー!! × スイーツパラダイス9店舗"
      ),
    want: null,
  },
  {
    name: "会場: 注記つき（※）は載せない",
    fn: () => venueForTitle([{ name: "全国 ※自動販売機を除く。※一部の店舗では、お取り扱いがない場合がございます。" }], "ちいかわ × サントリー"),
    want: null,
  },
  {
    name: "会場: 長すぎる会場名は載せない（商品名が押し出される）",
    fn: () => venueForTitle([{ name: "あ".repeat(25) }], "何かのコラボ"),
    want: null,
  },
  {
    name: "会場: 先頭の飾り記号だけ落とす（中身は言い換えない）",
    fn: () => venueForTitle([{ name: "■稲城天然温泉 季乃彩" }], "ラブライブ × サウナ"),
    want: "稲城天然温泉 季乃彩",
  },
  {
    name: "会場: 商品名と重複するなら足さない",
    fn: () => venueForTitle([{ name: "渋谷モディ" }], "約ネバ ポップアップストア in 渋谷モディ"),
    want: null,
  },
  {
    name: "タイトル: 会場があれば会場を出し、サイト名は落とす",
    fn: () =>
      itemPageTitle({
        name: "約ネバ 10周年 ポップアップストア in 渋谷モディ",
        heading: "開催日",
        date: "2026年8月21日(金)",
        hasLottery: false,
        period: "2026年8月21日〜8月30日",
        venue: "渋谷モディ 7F",
      }),
    want: "約ネバ 10周年 ポップアップストア in 渋谷モディ｜2026年8月21日〜8月30日 渋谷モディ 7F",
  },
  {
    name: "タイトル: 期間を持っていれば開始日ではなく期間を出す",
    fn: () =>
      itemPageTitle({
        name: "何かのコラボ",
        heading: "開催日",
        date: "8/21(金)",
        hasLottery: false,
        period: "2026年8月21日〜8月30日",
        venue: "渋谷モディ",
      }).includes("8月21日〜8月30日"),
    want: true,
  },
  {
    name: "タイトル: 会場が無い行は従来どおり見出しとサイト名を残す",
    fn: () =>
      itemPageTitle({
        name: "ワンピースカード 新弾",
        heading: "発売日",
        date: "9/5(金)",
        hasLottery: false,
        period: null,
        venue: null,
      }),
    want: "ワンピースカード 新弾の発売日｜9/5(金) | ハツコレ",
  },
  {
    name: "タイトル: 長すぎる期間テキストは使わず日付に落とす",
    fn: () =>
      itemPageTitle({
        name: "何かのくじ",
        heading: "発売日",
        date: "9/5(金)",
        hasLottery: false,
        period: "あ".repeat(31),
        venue: null,
      }),
    want: "何かのくじの発売日｜9/5(金) | ハツコレ",
  },
  {
    name: "アフィリリンクは link_type=hybrid_url を付ける（実物と同じ形）",
    fn: () => rakutenSearchUrl("ポケカ", "1a2b3c4d.5e6f7g8h.9i0j1k2l.3m4n5o6p").endsWith("&link_type=hybrid_url"),
    want: true,
  },
  {
    name: "m= は付けない（今のツールは吐かない）",
    fn: () => rakutenSearchUrl("ポケカ", "1a2b3c4d.5e6f7g8h.9i0j1k2l.3m4n5o6p").includes("&m="),
    want: false,
  },

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
  // ── 2026-08-21 追加: 地図URLの &amp;（実測 #117027: ?api=1&amp;query=… のまま保存され
  // クエリ名が amp;query に化けて地図検索が効かないリンクになっていた） ──
  {
    name: "地図URLの &amp; をデコードして保存する",
    fn: () =>
      extractMapUrl(
        '<tr><th>アクセス・地図</th><td><a href="https://www.google.com/maps/search/?api=1&amp;query=中部国際空港">地図</a></td></tr>'
      ),
    want: "https://www.google.com/maps/search/?api=1&query=中部国際空港",
  },
  // ── 2026-08-21 追加: 宙ぶらりん助詞の判定（audit (9) の純関数化） ──
  // 鳴る側: チャネル句が残った実バグの形（修正前の #117298 表示）
  { name: "宙ぶらりん判定: 「〜しまむら通販で」は鳴る", fn: () => looksTruncatedTitle("グローグー 刺しゅうTシャツ しまむら通販で"), want: true },
  // 鳴らない側: 「〜もの」は名詞語尾（実測 #118039・楽天165件で実在を裏取りした正規商品名）
  { name: "宙ぶらりん判定: 「名状しがたきもの」は鳴らない", fn: () => looksTruncatedTitle("30MM DAEMON X MACHINA TS 名状しがたきもの"), want: false },
  // ── 2026-08-21 追加: チャネル句＋日付告知の一括除去（#117298 の表示修正） ──
  {
    name: "日付直前の「〇〇通販で」も告知と一緒に落とす",
    fn: () => cleanListTitle("collabo_cafe", "グローグー 刺しゅうTシャツ しまむら通販で8月22日より受注販売!"),
    want: "グローグー 刺しゅうTシャツ",
  },
  // 鳴らない側: 空白で切れた「〜で」入り商品名は日付告知だけ剥がして本体を残す
  {
    name: "「で」入り商品名は巻き添えにしない（空白の節はまたがない）",
    fn: () => cleanListTitle("collabo_cafe", "ポケモンで遊ぼうセット 8月1日より発売!"),
    want: "ポケモンで遊ぼうセット",
  },
  // ── 2026-08-21 追加: ポケセンの Queue-it 待機室判定（実測 22時に一覧の代わりに返った） ──
  { name: "Queue-it待機室ページを名指しできる", fn: () => isQueueItPage('<meta id="queue-it_log" data-proxyurl="https://logging-x.queue-it.net/">'), want: true },
  { name: "通常HTMLはQueue-it扱いしない", fn: () => isQueueItPage('<div class="product-tile" data-pid="4521329371234">'), want: false },
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

  // ── sofvi.tokyo ソフビ情報（2026-08-15新設） ──────────
  // ニュース見出しを商品名にしない＝［ブランド］＋「商品名」を組み立てられる記事だけ載せる
  {
    name: "sofvi: ブランド＋商品名の組み立て",
    fn: () => sofviProductName("抽選受付締切は16日まで！「スーパー戦隊」の原点！［HEROES VINYL ART］に「秘密戦隊ゴレンジャー ソフビセット（劇中カラー）」登場！"),
    want: "HEROES VINYL ART 秘密戦隊ゴレンジャー ソフビセット（劇中カラー）",
  },
  { name: "sofvi: 「」が無い見出しは載せない", fn: () => sofviProductName("エビ沢キヨミのそふび道（超番外編）"), want: null },
  {
    name: "sofvi: 日だけの締切は記事日付の月で補完",
    fn: () => { const r = sofviEventInfo("抽選受付締切は16日まで！…", new Date(Date.UTC(2026, 7, 15))); return r ? `${r.eventType}|${ymd(r.date)}` : null; },
    want: "抽選|2026-08-16",
  },
  {
    name: "sofvi: 記事日より過去の日は翌月に倒す",
    fn: () => { const r = sofviEventInfo("抽選受付締切は2日まで！", new Date(Date.UTC(2026, 7, 15))); return r ? ymd(r.date) : null; },
    want: "2026-09-02",
  },
  {
    name: "sofvi: 日付の無い発売済みレポートは載せない",
    fn: () => sofviEventInfo("奇才・安楽安作氏が「マシュマロマン」を手掛けた！", new Date(Date.UTC(2026, 7, 15))),
    want: null,
  },

  // ── gunpla_resale ガンプラ再販カレンダー（2026-08-15新設） ──────────
  {
    name: "gunpla: 行のパース（名前・日付・新発売タグ・価格）",
    fn: () => {
      const html =
        '</head><table><tr><td><li><a href="#2608001">HGUC ザクI (旧ザク) </a></li></td><td width="10%">08/10(月)</td></tr>' +
        '<tr><td><li><a href="#26070809025">30MF 鉄禍ノ武闘家 【新発売】[8月延期]</a></li></td><td>08/29(土)</td></tr></table>' +
        '<table><tr><td id="2608001">HGUC ザクI (旧ザク)</td><td width="15%">1320</td><td>08/10(月)</td></tr></table>';
      const { rows, prices } = parseGunplaCalendar(html);
      return rows.map((r) => `${r.name}|${r.isNew}|${r.month}/${r.day}`).join(";") + `|price=${prices.get("2608001")}`;
    },
    want: "HGUC ザクI (旧ザク)|false|8/10;30MF 鉄禍ノ武闘家|true|8/29|price=1320",
  },
  {
    // 「未定」セクションの見出しは開閉ボタンの文言。日付が読めた見出しだけ文言を保存する
    // （実測 2026-08-20: 「▼ 未定 商品を表示 ▼」が61件の日付欄に出た）。
    name: "torecasoku: 日付の無い見出しの文言は保存しない",
    fn: () => {
      const html =
        '<ul class="goods_list"><li class="releasedate-section" data-release="99999999">▼ 未定 商品を表示 ▼</li>' +
        '<li class="goods_info"><div class="group_parent"><div class="title"><a href="/tcg/archives/1">テスト商品パック</a></div></div></li></ul>';
      return parseTorecasokuList(html).map((i) => `${i.eventDate}|${i.eventDateText}`).join(";");
    },
    want: "null|null",
  },
  {
    // 月別ページの「未定」セクションは、読者に見えている見出し（h1）の月を月精度で持たせる。
    // 日は作らない（eventDate は null のまま）。観点A実測 2026-08-20（#68180: 収集元の
    // 商品ページは「発売日 2026年11月未定」なのに、こちらは「日付未定」で出していた）。
    name: "torecasoku: 未定セクションはページの月を月精度で持たせる",
    fn: () => {
      const html =
        '<h1 class="entry-titlekiji">2026年11月1日 ～ 11月30日 発売一覧</h1>' +
        '<ul class="goods_list"><li class="releasedate-section" data-release="20261132">▼ 未定 商品を表示 ▼</li>' +
        '<li class="goods_info"><div class="group_parent"><div class="title"><a href="/tcg/archives/1">テスト商品パック</a></div></div></li></ul>';
      return parseTorecasokuList(html).map((i) => `${i.eventDate}|${i.eventDateText}`).join(";");
    },
    want: "null|2026年11月発売予定",
  },
  {
    // 鳴らない側①: 月は h1 の表示文言からだけ作る。h1 が月の形でなければ何も足さない
    // （data-release 属性 "20261132" の月から作ってはいけない＝ミス38の規約）。
    name: "torecasoku: h1が読めなければ未定セクションに月を足さない",
    fn: () => {
      const html =
        "<h1>発売日カレンダー</h1>" +
        '<ul class="goods_list"><li class="releasedate-section" data-release="20261132">▼ 未定 商品を表示 ▼</li>' +
        '<li class="goods_info"><div class="group_parent"><div class="title"><a href="/tcg/archives/1">テスト商品パック</a></div></div></li></ul>';
      return parseTorecasokuList(html).map((i) => `${i.eventDate}|${i.eventDateText}`).join(";");
    },
    want: "null|null",
  },
  {
    // 鳴らない側②: 日付が読めた見出しの行は従来どおり（ページの月に置き換えない）。
    name: "torecasoku: 日付が読めた見出しはh1があっても文言を保存する",
    fn: () => {
      const html =
        '<h1 class="entry-titlekiji">2026年11月1日 ～ 11月30日 発売一覧</h1>' +
        '<ul class="goods_list"><li class="releasedate-section" data-release="20261106">11月6日（金）頃発売</li>' +
        '<li class="goods_info"><div class="group_parent"><div class="title"><a href="/tcg/archives/3">テスト商品パック</a></div></div></li></ul>';
      const r = parseTorecasokuList(html)[0];
      return `${r?.eventDate?.toISOString().slice(0, 10)}|${r?.eventDateText}`;
    },
    want: "2026-11-06|11月6日（金）頃発売",
  },
  {
    name: "torecasoku: 日付が読めた見出しは文言も保存する",
    fn: () => {
      const html =
        '<ul class="goods_list"><li class="releasedate-section" data-release="20260801">8月1日（土）頃発売</li>' +
        '<li class="goods_info"><div class="group_parent"><div class="title"><a href="/tcg/archives/2">テスト商品パック</a></div></div></li></ul>';
      const r = parseTorecasokuList(html)[0];
      return `${r?.eventDate?.toISOString().slice(0, 10)}|${r?.eventDateText}`;
    },
    want: "2026-08-01|8月1日（土）頃発売",
  },
  {
    // 日付セルの文言を捨てない。リンク先が楽天検索＝一次情報との突合ができない唯一の
    // 大口(122件)なので、文言が date_text_mismatch の網に入る唯一の突合相手になる。
    name: "gunpla: 日付セルの文言をそのまま持ち帰る",
    fn: () =>
      parseGunplaCalendar(
        '</head><table><tr><td><li><a href="#x1">HGUC ザクI </a></li></td><td width="10%">08/10(月)</td></tr></table>'
      ).rows[0]?.dateText,
    want: "08/10(月)",
  },
  { name: "gunpla: 編集タグ除去", fn: () => cleanGunplaName("ENTRY GRADE ガンダム 【新発売】[8月追加]").name, want: "ENTRY GRADE ガンダム" },

  // ── card_chusen 店舗別トレカ抽選（2026-08-15新設） ──────────
  // 商品名の表記ゆれ・語順ゆれの名寄せ（実測: 同じ弾が店ごとに5表記あった）
  { name: "cardchusen: ゲーム接頭辞違いを同じ商品に束ねる", fn: () => productKey("ポケモンカード ストームエメラルダ") === productKey("ポケモンカードゲーム MEGA 拡張パック「ストームエメラルダ」"), want: true },
  { name: "cardchusen: 語順違い(OP-17)も束ねる", fn: () => productKey("ONE PIECEカードゲーム ブースターパック 世界最強の戦士【OP-17】") === productKey("ONE PIECEカードゲーム ブースターパック OP-17「世界最強の戦士」"), want: true },
  { name: "cardchusen: 別の弾は束ねない", fn: () => productKey("ポケモンカードゲーム MEGA 拡張パック「メガブレイブ」") === productKey("ポケモンカードゲーム MEGA 拡張パック「メガシンフォニア」"), want: false },
  // 店が商品名欄に自店の売り方を書き足すと、同じ弾が別行に割れる（実測 2026-08-18:
  // OP-17 が10行）。条件は名前から外して束ね、外した条件はその店の note に残す。
  { name: "cardchusen: 店ごとの販売条件は商品名から外して束ねる", fn: () => productKey("ONE PIECEカードゲーム ブースターパック 世界最強の戦士【OP-17】 1BOX（5,760円税込・現金払いのみ）") === productKey("ONE PIECEカードゲーム ブースターパック 世界最強の戦士【OP-17】"), want: true },
  { name: "cardchusen: 数量だけ違う行も同じ商品", fn: () => productKey("ONE PIECEカードゲーム ブースターパック 世界最強の戦士【OP-17】 2BOX") === productKey("ONE PIECEカードゲーム ブースターパック 世界最強の戦士【OP-17】"), want: true },
  { name: "cardchusen: 再販・再入荷も同じ商品に束ねる", fn: () => productKey("ポケモンカードゲーム MEGA 拡張パック「ストームエメラルダ」【再入荷】") === productKey("ポケモンカードゲーム MEGA 拡張パック「ストームエメラルダ」"), want: true },
  // **括弧を一律に落とすと壊れる**: 中身が「別商品の列挙」のことがある。
  { name: "cardchusen: 中身違い(御三家8種)は別商品のまま", fn: () => productKey("ポケモンカード 30th CELEBRATION 御三家カードセット（フシギダネ・ヒトカゲ・ゼニガメ）") === productKey("ポケモンカード 30th CELEBRATION 御三家カードセット（チコリータ・ヒノアラシ・ワニノコ）"), want: false },
  { name: "cardchusen: 外した条件は店のnoteに残す", fn: () => splitSaleConditions("ONE PIECEカードゲーム ブースターパック 世界最強の戦士【OP-17】 1BOX（5,760円税込・現金払いのみ）").conds.join("・"), want: "5,760円税込・現金払いのみ・1BOX" },
  { name: "cardchusen: 型番だけの括弧は弾名が残る時だけ落とす", fn: () => productKey("遊戯王OCGデュエルモンスターズ LIMITED PACK WORLD CHAMPIONSHIP 2026 [26LP]") === productKey("遊戯王OCG LIMITED PACK WORLD CHAMPIONSHIP 2026"), want: true },
  // 定型語を削ると3文字になる商品（151/100）を「短すぎ」で捨てると、受付中の抽選が
  // どのページにも出ない。束ねる時だけ語順ソートを使わないことで誤マージも避ける。
  { name: "cardchusen: 3文字の弾名も掲載対象に残す", fn: () => productKey("ポケモンカード 強化拡張パック ポケモンカード151").length >= 2, want: true },
  { name: "cardchusen: 3文字は語順ソートで別商品と衝突させない", fn: () => productKey("ポケモンカード 拡張パック 151") === productKey("ポケモンカード 拡張パック 115"), want: false },
  // 収集元の「本日/明日」は**保存する時点で暦日に解決する**（2026-08-16の事故）。
  // 保存文字列に相対表記が残ると、巡回した日を過ぎた瞬間に締切が1日ズレる。
  { name: "cardchusen: 締切 本日は当日日付＋絶対表記で保存", fn: () => { const d = parseDue("締切 本日 22:00", today); return d ? `${d.kind}|${ymd(d.date!)}|${d.label}` : null; }, want: "締切|2026-08-08|〜8/8 22:00" },
  { name: "cardchusen: 締切 M/D(曜)", fn: () => { const d = parseDue("締切 8/17(月) 13:00", today); return d ? ymd(d.date!) + "|" + d.label : null; }, want: "2026-08-17|〜8/17 13:00" },
  { name: "cardchusen: 調査中は日付を作らない", fn: () => parseDue("締切 調査中", today)?.date ?? "no", want: "no" },
  { name: "cardchusen: 開始（近日受付）は明日でも絶対表記＋開始形", fn: () => parseDue("開始 明日 13:00", today)?.label, want: "8/9 13:00〜" },
  { name: "cardchusen: 保存ラベルに相対日付を残さない", fn: () => ["締切 本日 22:00", "締切 明日 23:59", "開始 明日 10:00"].some((t) => hasFrozenRelativeDate(parseDue(t, today)!.label)), want: false },
  {
    // 実測: title属性の &amp; が未復号のまま本番カードに「ルフィ&amp;エース」と出た（audit:page が35件検出）
    name: "cardchusen: title属性のHTMLエンティティを実文字に戻す",
    fn: () => {
      const html =
        '</head><div class="board-card__tags"><span class="board-cond__txt">会員</span></div>' +
        '<p class="board-card__store" title="ONE PIECEカードゲーム スタートデッキEX ルフィ&amp;エース【ST-29】">テスト店</p>' +
        '<div class="board-card__due"> 締切 本日 23:59 </div>' +
        '<a class="board-card__cta" href="https://example.com/l/1">応募</a>';
      return parseCardChusen(html, today)[0]?.product ?? null;
    },
    want: "ONE PIECEカードゲーム スタートデッキEX ルフィ&エース【ST-29】",
  },
  {
    // 実測 2026-08-21: 応募リンクを持たないカード（375枚中50枚）の店が隣のカードのCTAを拾い、
    // 8枠が別の店・別の商品の応募ページへ誘導していた（京山店OP-13→ガンリュウ小田原店OP-17）。
    // カード境界(id="card-…")をまたいでURLを拾わないこと＝リンク無しカードは載せない。
    name: "cardchusen: 応募リンクの無いカードが隣のカードのURLを拾わない",
    fn: () => {
      const html =
        '</head><div id="card-a-store-2026-08-21" data-card>' +
        '<p class="board-card__store" title="商品A【OP-13】">リンク無し店</p>' +
        '<div class="board-card__due"> 締切 8/23(日) 23:59 </div></div>' +
        '<div id="card-b-store-2026-08-21" data-card>' +
        '<p class="board-card__store" title="商品B【OP-17】">リンクあり店</p>' +
        '<div class="board-card__due"> 締切 8/24(月) 23:59 </div>' +
        '<a class="board-card__cta" href="https://example.com/b">応募</a></div>';
      const got = parseCardChusen(html, today);
      return got.map((e) => `${e.store}|${e.url}`).join(",");
    },
    want: "リンクあり店|https://example.com/b",
  },

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

  // ── 相対日付の凍結（2026-08-16。「〜明日 22:00」が翌日から1日ズレていた事故） ──────
  // 鳴る側と鳴らない側を両方固定する。**作品名を巻き込む検査は誤報する検査＝信用されない。**
  { name: "相対日付: 保存された締切は鳴る", fn: () => hasFrozenRelativeDate("〜明日 23:59"), want: true },
  { name: "相対日付: 本日＋時刻は鳴る", fn: () => hasFrozenRelativeDate("本日 22:00まで受付"), want: true },
  { name: "相対日付: 明日まで は鳴る", fn: () => hasFrozenRelativeDate("明日まで抽選受付中"), want: true },
  { name: "相対日付: 作品名『明日ちゃんのセーラー服』は鳴らない", fn: () => hasFrozenRelativeDate("明日ちゃんのセーラー服 アクリルスタンド"), want: false },
  { name: "相対日付: 人名『天上院明日香』は鳴らない", fn: () => hasFrozenRelativeDate("遊☆戯☆王GX BIG缶バッジ 天上院明日香"), want: false },
  { name: "相対日付: 絶対表記は鳴らない", fn: () => hasFrozenRelativeDate("〜8/21 23:59"), want: false },

  // 表示側は today から相対表記を作る（保存物は絶対のまま＝古くなっても嘘にならない）
  { name: "受付ラベル: 当日は本日と出す", fn: () => storeWhenLabel({ name: "店", url: null, form: "抽選", when: "〜8/8 22:00", note: null, at: "2026-08-08", kind: "締切" }, today), want: "〜本日 22:00" },
  { name: "受付ラベル: 翌日は明日と出す", fn: () => storeWhenLabel({ name: "店", url: null, form: "抽選", when: "〜8/9 23:59", note: null, at: "2026-08-09", kind: "締切" }, today), want: "〜明日 23:59" },
  { name: "受付ラベル: 先の日付はそのまま", fn: () => storeWhenLabel({ name: "店", url: null, form: "抽選", when: "〜8/21 18:00", note: null, at: "2026-08-21", kind: "締切" }, today), want: "〜8/21 18:00" },
  // 「受付中ストア」の見出しの下に、まだ始まっていない店が同じ顔で並んでいた（実測）
  { name: "受付ラベル: 開始が未来なら受付前と書く", fn: () => storeWhenLabel({ name: "店", url: null, form: "抽選", when: "8/20 00:00〜", note: null, at: "2026-08-20", kind: "開始" }, today), want: "8/20 00:00〜（受付前）" },
  { name: "受付ラベル: 開始が過去なら受付前と書かない", fn: () => storeWhenLabel({ name: "店", url: null, form: "抽選", when: "7/8 12:00〜", note: null, at: "2026-07-08", kind: "開始" }, today), want: "7/8 12:00〜" },
  { name: "受付ラベル: 暦日を持たない旧データは保存文字列のまま", fn: () => storeWhenLabel({ name: "店", url: null, form: "抽選", when: "締切時刻 調査中", note: null }, today), want: "締切時刻 調査中" },

  // 保存済みの凍結ラベルを、巡回時刻を基準に絶対表記へ戻す（既存行の修復）
  { name: "凍結解除: 明日は巡回日の翌日に解決", fn: () => { const u = unfreezeStoreWhen("〜明日 22:00", null, new Date("2026-08-15T13:49:00Z")); return `${u.when}|${u.at}|${u.kind}`; }, want: "〜8/16 22:00|2026-08-16|締切" },
  { name: "凍結解除: 本日は巡回日(JST)に解決", fn: () => { const u = unfreezeStoreWhen("〜本日 22:00", null, new Date("2026-08-15T13:49:00Z")); return `${u.when}|${u.at}`; }, want: "〜8/15 22:00|2026-08-15" },
  { name: "凍結解除: 絶対表記は文字列を変えず暦日だけ足す", fn: () => { const u = unfreezeStoreWhen("〜8/21 23:59", null, new Date("2026-08-15T13:49:00Z")); return `${u.when}|${u.at}`; }, want: "〜8/21 23:59|2026-08-21" },
  { name: "凍結解除: 開始形は kind=開始 と読む", fn: () => unfreezeStoreWhen("8/20 00:00〜", null, new Date("2026-08-15T13:49:00Z")).kind, want: "開始" },

  // ── 締切の「幅」を1つの日付に潰さない（2026-08-16・観点D／本番で商品が丸ごと消えていた） ──
  // 1商品が143店・締切8/15〜8/26 という*幅*を持つのに、eventDate に巡回日基準の「最短」を
  // 焼き付けていたため、翌日には表示スコープから商品ごと落ちた（#75417＝締切前102店が不在）。
  // 表示日は today から作り直し、DBは「最後の締切」を持つ。
  { name: "締切: 過ぎた枠を飛ばし、まだ締切前の最短を表示日にする", fn: () => soonestOpenDeadline(S([["2026-08-01", "締切"], ["2026-08-21", "締切"]]), today)?.toISOString().slice(0, 10) ?? "null", want: "2026-08-21" },
  { name: "締切: 当日の締切はまだ有効（最短に選ぶ）", fn: () => soonestOpenDeadline(S([["2026-08-08", "締切"], ["2026-08-21", "締切"]]), today)?.toISOString().slice(0, 10) ?? "null", want: "2026-08-08" },
  { name: "締切: 全部過ぎていたら null", fn: () => soonestOpenDeadline(S([["2026-08-01", "締切"], ["2026-08-05", "締切"]]), today)?.toISOString().slice(0, 10) ?? "null", want: "null" },
  { name: "締切: 開始日の枠は締切として数えない", fn: () => soonestOpenDeadline(S([["2026-08-20", "開始"]]), today)?.toISOString().slice(0, 10) ?? "null", want: "null" },
  { name: "締切: 暦日を持たない枠（調査中）は判断材料にしない", fn: () => soonestOpenDeadline([{ name: "店", url: null, form: "抽選", when: "締切時刻 調査中", note: null }], today)?.toISOString().slice(0, 10) ?? "null", want: "null" },
  { name: "期限: 最後の締切を載せてよい期限にする", fn: () => lastDeadline(S([["2026-08-08", "締切"], ["2026-08-26", "締切"], ["2026-08-21", "締切"]]))?.toISOString().slice(0, 10) ?? "null", want: "2026-08-26" },

  // ── 「受付中」と書く節に、締切が過ぎた店を混ぜない（2026-08-18・観点B） ──
  // 実測: /items/75417 の「受付中ストア（126店）」の先頭30店が昨日締切だった。
  // 8/16 に直したのはカード要約と上部の抽選日だけで、詳細ページの一覧本体が残っていた。
  // 落とす条件は soonestOpenDeadline と同じ＝**締切の暦日を知っている枠だけ**を終わったと言う。
  { name: "受付中の仕分け: 過ぎた締切は closed へ", fn: () => { const r = splitStoresByDeadline(S([["2026-08-01", "締切"], ["2026-08-21", "締切"]]), today); return `${r.open.length}/${r.closed.length}`; }, want: "1/1" },
  { name: "受付中の仕分け: 当日の締切はまだ open", fn: () => { const r = splitStoresByDeadline(S([["2026-08-08", "締切"]]), today); return `${r.open.length}/${r.closed.length}`; }, want: "1/0" },
  { name: "受付中の仕分け: 受付開始待ちは落とさない（受付前として出す）", fn: () => { const r = splitStoresByDeadline(S([["2026-08-20", "開始"]]), today); return `${r.open.length}/${r.closed.length}`; }, want: "1/0" },
  { name: "受付中の仕分け: 過去の開始日も落とさない（開始は締切ではない）", fn: () => { const r = splitStoresByDeadline(S([["2026-07-01", "開始"]]), today); return `${r.open.length}/${r.closed.length}`; }, want: "1/0" },
  { name: "受付中の仕分け: 締切が分からない枠は落とさない", fn: () => { const r = splitStoresByDeadline([{ name: "店", url: null, form: "抽選", when: "締切時刻 調査中", note: null }], today); return `${r.open.length}/${r.closed.length}`; }, want: "1/0" },
  { name: "受付中の仕分け: 開催店舗（kind なし）は落とさない", fn: () => { const r = splitStoresByDeadline([{ name: "会場", url: null, form: "東京都", when: null, note: null }], today); return `${r.open.length}/${r.closed.length}`; }, want: "1/0" },
  { name: "受付中の仕分け: 全部過ぎたら open が0になる（節の文言を変える合図）", fn: () => { const r = splitStoresByDeadline(S([["2026-08-01", "締切"], ["2026-08-05", "締切"]]), today); return `${r.open.length}/${r.closed.length}`; }, want: "0/2" },

  // 描画側の網。**この粗は巡回直後だけ消える**ので、本番を測った0件は直っている証拠にならない。
  // だから判定を純関数にして、鳴る側と鳴らない側を合成データで固定する。
  { name: "描画: 過ぎた締切が受付中の節に並んでいたら鳴る（鳴る側）", fn: () => !!closedStoreRowProblem("ビックカメラ柏店 抽選 〜8/1 19:00 条件: 会員 応募ページ →", today, parseDisplayedDate), want: true },
  { name: "描画: まだ先の締切では鳴らない", fn: () => closedStoreRowProblem("ミント仙台店 抽選 〜8/21 12:00 応募ページ →", today, parseDisplayedDate), want: null },
  { name: "描画: 当日の締切では鳴らない", fn: () => closedStoreRowProblem("HMV 抽選 〜8/8 23:59 応募ページ →", today, parseDisplayedDate), want: null },
  { name: "描画: 「〜本日/明日」は表示時に作るので対象外", fn: () => closedStoreRowProblem("TCバトロコ 抽選 〜本日 12:00 応募ページ →", today, parseDisplayedDate), want: null },
  { name: "描画: 受付開始の表記（8/20 00:00〜）は締切ではない", fn: () => closedStoreRowProblem("おもちゃのペリカン 抽選 8/1 00:00〜（受付前） 応募ページ →", today, parseDisplayedDate), want: null },
  { name: "描画: 締切表記が無い行では鳴らない", fn: () => closedStoreRowProblem("Amazon.co.jp 抽選 締切時刻 調査中 応募ページ →", today, parseDisplayedDate), want: null },
  { name: "描画: 年跨ぎ（基準日から見て最も近い年）を過去と誤判定しない", fn: () => closedStoreRowProblem("店 抽選 〜1/5 23:59 応募ページ →", today, parseDisplayedDate), want: null },
  { name: "期限: 締切の暦日が無ければ null（＝触らない）", fn: () => lastDeadline(S([["2026-08-20", "開始"]]))?.toISOString().slice(0, 10) ?? "null", want: "null" },
  // 詳細ページ側: 表示日だけ差し替え、落とさない（直リンク・検索流入の入口なので404にしない）
  { name: "詳細: 過去日の eventDate をまだ締切前の最短に直す", fn: () => { const r = withLiveStoreDeadline({ id: 1, source: "card_chusen", title: "x", url: null, eventDate: new Date("2026-08-01T00:00:00Z"), price: null, imageUrl: null, stores: JSON.stringify(S([["2026-08-01", "締切"], ["2026-08-21", "締切"]])) }, today); return (r.eventDate as Date).toISOString().slice(0, 10); }, want: "2026-08-21" },
  { name: "詳細: 全部過ぎていれば eventDate は変えない（404にしない）", fn: () => { const r = withLiveStoreDeadline({ id: 1, source: "card_chusen", title: "x", url: null, eventDate: new Date("2026-08-01T00:00:00Z"), price: null, imageUrl: null, stores: JSON.stringify(S([["2026-08-01", "締切"]])) }, today); return (r.eventDate as Date).toISOString().slice(0, 10); }, want: "2026-08-01" },
  { name: "詳細: stores を持たない行は素通り", fn: () => { const r = withLiveStoreDeadline({ id: 1, source: "figisland", title: "x", url: null, eventDate: new Date("2026-08-01T00:00:00Z"), price: null, imageUrl: null }, today); return (r.eventDate as Date).toISOString().slice(0, 10); }, want: "2026-08-01" },

  // 「本日」の基準は**日本時間**の暦日。UTC の暦日を使うと 09:00 JST 前の巡回で1日早くなる。
  // 実測 2026-08-16 06:39 JST(=21:39Z): 締切197枠中93枠(47%)が前日に解決され、
  // まだ今日応募できる抽選を「昨日締切」と表示していた（＋商品が全一覧から消えた）。
  { name: "JST暦日: 09時前の巡回でも当日（21:39Z→翌JST日）", fn: () => jstCalDate(Date.parse("2026-08-15T21:39:06Z")).toISOString().slice(0, 10), want: "2026-08-16" },
  { name: "JST暦日: 夜の巡回は同じ日（13:49Z＝JST 8/15 22:49）", fn: () => jstCalDate(Date.parse("2026-08-15T13:49:00Z")).toISOString().slice(0, 10), want: "2026-08-15" },
  { name: "JST暦日: JST 08:59 は前日扱いにしない", fn: () => jstCalDate(Date.parse("2026-08-15T23:59:00Z")).toISOString().slice(0, 10), want: "2026-08-16" },
  { name: "JST暦日: JST 00:00 ちょうど", fn: () => jstCalDate(Date.parse("2026-08-15T15:00:00Z")).toISOString().slice(0, 10), want: "2026-08-16" },
  { name: "締切解決: 09時前の巡回で「本日」が当日になる", fn: () => parseDue("締切 本日 22:00", jstCalDate(Date.parse("2026-08-15T21:39:06Z")))?.date?.toISOString().slice(0, 10) ?? "null", want: "2026-08-16" },
  { name: "締切解決: 09時前の巡回で「明日」が翌日になる", fn: () => parseDue("締切 明日 22:00", jstCalDate(Date.parse("2026-08-15T21:39:06Z")))?.date?.toISOString().slice(0, 10) ?? "null", want: "2026-08-17" },

  // ── 時計を読む行の静的検査（audit の clock_discipline / npm run audit:clocklint）──
  //
  // 「今日を求める関数が2つ以上あってはいけない」は rules.md に文章で書いてあったのに、
  // 翌日に数えたら +9h の実装が6箇所あった。**文章で守れなかったものは機械に落とすまで
  // 守れていない**ので、検出器そのものをここで固定する。鳴る側と鳴らない側の両方を置く。
  { name: "時計lint: 引数なし new Date() を検出", fn: () => cl("const t = new Date();")[0]?.rule ?? "none", want: "wall_clock" },
  { name: "時計lint: Date.now() を検出", fn: () => cl("const t = Date.now();")[0]?.rule ?? "none", want: "wall_clock" },
  { name: "時計lint: ローカル時刻ゲッターを検出", fn: () => cl("const y = d.getFullYear();")[0]?.rule ?? "none", want: "local_getter" },
  { name: "時計lint: ローカル時刻セッターを検出", fn: () => cl("d.setDate(d.getUTCDate() - 60);")[0]?.rule ?? "none", want: "local_setter" },
  { name: "時計lint: new Date(年,月,日) を検出", fn: () => cl("const d = new Date(2026, 7, 16);")[0]?.rule ?? "none", want: "local_ctor" },
  { name: "時計lint: TZ未指定の日時整形を検出", fn: () => cl('d.toLocaleDateString("ja-JP")')[0]?.rule ?? "none", want: "tz_unspecified_format" },
  { name: "時計lint: テンプレート内のコードも見る", fn: () => cl("const s = `更新 ${new Date().toUTCString()}`;")[0]?.rule ?? "none", want: "wall_clock" },
  // 鳴ってはいけない側。誤報する検査は本物を埋もれさせる（ミス12・14）。
  { name: "時計lint・誤報: Date.UTC で作る暦日は鳴らない", fn: () => cl("const d = new Date(Date.UTC(y, m, 1));").length, want: 0 },
  { name: "時計lint・誤報: getUTC* は鳴らない", fn: () => cl("const y = d.getUTCFullYear(); const m = d.getUTCMonth();").length, want: 0 },
  { name: "時計lint・誤報: 引数つき new Date は鳴らない", fn: () => cl('const d = new Date("2026-08-16T00:00:00Z"); const e = new Date(ms);').length, want: 0 },
  { name: "時計lint・誤報: 数値の桁区切り toLocaleString は鳴らない", fn: () => cl('const s = yen.toLocaleString("ja-JP");').length, want: 0 },
  { name: "時計lint・誤報: TZを明示した整形は鳴らない", fn: () => cl('d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric" })').length, want: 0 },
  { name: "時計lint・誤報: コメント内の new Date() は鳴らない", fn: () => cl("// 以前は new Date() を使っていた\n/* Date.now() も同様 */").length, want: 0 },
  { name: "時計lint・誤報: 文字列内の new Date() は鳴らない", fn: () => cl('const msg = "new Date() は禁止";').length, want: 0 },
  { name: "時計lint・誤報: 正規表現の直後の行を読み飛ばさない", fn: () => cl("const re = /https:\\/\\/x\\.com/;\nconst t = new Date();").length, want: 1 },
  { name: "時計lint: date.ts 自身は検査から外す", fn: () => isClockLinted("src/lib/date.ts"), want: false },
  { name: "時計lint: 他のファイルは検査する", fn: () => isClockLinted("src/scrapers/cardChusen.ts"), want: true },

  // ── 画面に出ている日付の整合（描画監査 audit:page が使う純関数）──────────
  // 2026-08-16 の実物: 上部「抽選日 2026年8月16日(日) 🔥本日」／下の店舗行「〜明日 22:00」。
  // today は 2026-08-08（このファイルの基準日）。
  { name: "画面日付: 曜日が暦と違う", fn: () => renderedDateProblems("2026年8月16日(月)", today).length, want: 1 },
  { name: "画面日付: 正しい曜日は鳴らない", fn: () => renderedDateProblems("2026年8月16日(日)", today).length, want: 0 },
  { name: "画面日付: 短縮形の曜日も見る", fn: () => renderedDateProblems("8/16(月) 発売", today).length, want: 1 },
  // カウントダウンのバッジと日付ラベルの突合は、**同じカードの要素同士**で行う。
  // テキストの隣接で判定した最初の版は、本番の描画（「🔥 本日ワンピースカード8/16(日)」＝
  // 別要素が隙間なく繋がる）で 1枚も突き合わせられず、しかも作品名「明日ちゃんのセーラー服」を
  // 誤検出した。両方向に間違える判定だったので、要素単位に作り直した。
  { name: "カード日付: 「本日」なのに今日でない", fn: () => countdownBadgeProblem("🔥 本日", "8/16(日)", today) !== null, want: true },
  { name: "カード日付: 「本日」が本当に今日なら鳴らない", fn: () => countdownBadgeProblem("🔥 本日", "8/8(土)", today), want: null },
  { name: "カード日付: 「明日」が翌日なら鳴らない", fn: () => countdownBadgeProblem("明日", "8/9(日)", today), want: null },
  { name: "カード日付: 「あと3日」の食い違い", fn: () => countdownBadgeProblem("あと3日", "8/9(日)", today) !== null, want: true },
  { name: "カード日付: 「あと1日」＝明日なら鳴らない", fn: () => countdownBadgeProblem("あと1日", "8/9(日)", today), want: null },
  { name: "カード日付: 年つき長形式も読む", fn: () => countdownBadgeProblem("🔥 本日", "2026年8月8日(土)", today), want: null },
  { name: "カード日付: 月精度の表示は対象外（合成日で判定しない）", fn: () => countdownBadgeProblem("🔥 本日", "2026年9月", today), want: null },
  { name: "カード日付: バッジでない文字列は対象外", fn: () => countdownBadgeProblem("予約受付中", "8/16(日)", today), want: null },
  { name: "カード日付: 年をまたぐ短縮表示は近い方の年で読む", fn: () => parseDisplayedDate("1/5(火)", today)?.toISOString().slice(0, 10), want: "2027-01-05" },
  { name: "画面日付・誤報: 価格や型番の数字を日付と読まない", fn: () => renderedDateProblems("¥8,900 ST-29 HG 1/144", today).length, want: 0 },
  // 実測（本番 /release/2027-01 で誤報）: カレンダーの日付グリッド「…3031」に見出し
  // 「1月1日(金)」が続き、text() の連結で「311月1日(金)」＝**11月1日**と読んでしまった。
  // 検出器の誤報は本物を埋もれさせる（ミス12・14）ので、数字の境界をその場で固定する。
  { name: "画面日付・誤報: 直前の数字と繋げて月日を読まない（カレンダーの連結）", fn: () => renderedDateProblems("28293031" + "1月1日(金) 1件", today).length, want: 0 },

  // カードの「受付中ストア：」は保存文字列＝締切の近い順の先頭3件。日が経つと先頭が
  // ちょうど期限切れの店になる。表示時に「今まさに受付中の店」だけへ絞り直す。
  // **相対表記(本日/明日)はここでは作らない**（audit frozen_relative_date と区別できなくなるため）。
  { name: "カード要約: 期限切れの店を落とす", fn: () => liveStoreSummary("受付中ストア：店1（抽選・〜8/1）、店2（抽選・〜8/21）", [{ name: "店1", url: null, form: "抽選", when: "〜8/1", note: null, at: "2026-08-01", kind: "締切" }, { name: "店2", url: null, form: "抽選", when: "〜8/21", note: null, at: "2026-08-21", kind: "締切" }], today), want: "受付中ストア：店2（抽選・〜8/21）" },
  { name: "カード要約: まだ始まっていない店は受付中に数えない", fn: () => liveStoreSummary("受付中ストア：店1（抽選・8/20 00:00〜）、店2（抽選・〜8/21）", [{ name: "店1", url: null, form: "抽選", when: "8/20 00:00〜", note: null, at: "2026-08-20", kind: "開始" }, { name: "店2", url: null, form: "抽選", when: "〜8/21", note: null, at: "2026-08-21", kind: "締切" }], today), want: "受付中ストア：店2（抽選・〜8/21）" },
  { name: "カード要約: 相対表記を作らない（本日/明日を混ぜない）", fn: () => /本日|明日/.test(liveStoreSummary("受付中ストア：店1（抽選・〜8/1）、店2（抽選・〜8/8）", [{ name: "店1", url: null, form: "抽選", when: "〜8/1", note: null, at: "2026-08-01", kind: "締切" }, { name: "店2", url: null, form: "抽選", when: "〜8/8", note: null, at: "2026-08-08", kind: "締切" }], today) ?? ""), want: false },
  { name: "カード要約: 全部受付中なら触らない", fn: () => liveStoreSummary("受付中ストア：そのまま", [{ name: "店2", url: null, form: "抽選", when: "〜8/21", note: null, at: "2026-08-21", kind: "締切" }], today), want: "受付中ストア：そのまま" },
  { name: "カード要約: 締切が分からない枠は落とさない", fn: () => liveStoreSummary("受付中ストア：x", [{ name: "店", url: null, form: "抽選", when: "締切時刻 調査中", note: null }], today), want: "受付中ストア：x" },
  { name: "カード要約: 「受付中ストア：」以外の要約は触らない", fn: () => liveStoreSummary("抽選受付 〜8/16", [{ name: "店1", url: null, form: "抽選", when: "〜8/1", note: null, at: "2026-08-01", kind: "締切" }], today), want: "抽選受付 〜8/16" },

  // ── 「日付未定」なのに商品名が時期を言っている（2026-08-16・観点C 通読で発見） ──────
  // **日は作らない**（月精度のテキストだけ）。年も推測しない（過去月は読まない）。
  { name: "月精度: 12月発売 を読む", fn: () => monthPrecisionFromTitle("ダンガンロンパ 超高校級の「くるみたぴぬい 全8種」12月発売!", today), want: "2026年12月発売予定" },
  { name: "月精度: 上旬まで拾う", fn: () => monthPrecisionFromTitle("映画ちいかわ ゆらゆらソーラー 8月上旬登場!", today), want: "2026年8月上旬登場予定" },
  { name: "月精度: 「待望の9月再販!」も読む", fn: () => monthPrecisionFromTitle("「とある」シリーズ 人気グッズ 9月待望の再販!", today), want: "2026年9月再販予定" },
  { name: "月精度: 日まで書いてあるものには手を出さない", fn: () => monthPrecisionFromTitle("BANANA FISH ポップアップ 8月28日より渋谷にて開催", today), want: null },
  { name: "月精度: 過ぎた月は年を推測せず読まない", fn: () => monthPrecisionFromTitle("旧グッズ 7月発売!", today), want: null },
  { name: "月精度: 「10周年記念」の数字を月と読まない", fn: () => monthPrecisionFromTitle("ヒロアカ 10周年記念グッズ", today), want: null },
  { name: "月精度: 月と動詞が離れていたら読まない", fn: () => monthPrecisionFromTitle("8月の新作をまとめて紹介するイベントが開催", today), want: null },

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
    // 実測 2026-08-16: 候補名からは長音「ー」を落として比較しているのに、こちらの語は「ー」付きの
    // ままだったので、**長音を含む語が全部外れて**いた（ガンプラ再販44件は検索1位が正解なのに
    // 1件も一致しなかった）。語と候補は同じ正規化を通す。
    name: "画像: 長音を含む語でも同一商品と分かる",
    fn: () =>
      productNameMatches(
        "30MS SIS-J00 メルンジャ[カラーA]",
        "BANDAI SPIRITS(バンダイ スピリッツ) 30MS SIS-J00 メルンジャ[カラーA] 色分け済みプラモデル"
      ),
    want: true,
  },
  {
    name: "画像: 「スカーレット」のような長音語を含む商品名も一致する",
    fn: () =>
      productNameMatches(
        "ポケモンカードゲーム スカーレット＆バイオレット 強化拡張パック 熱風のアリーナ",
        "【送料無料】ポケモンカードゲーム　スカーレット＆バイオレット　強化拡張パック　熱風のアリーナ　1パック（5枚入）"
      ),
    want: true,
  },
  {
    // こちらが付けた販売条件（再販分・購入権チケット）は商品の同一性に関係しない。
    name: "画像: 販売条件の語は同一性の判定に使わない",
    fn: () =>
      productNameMatches(
        "ONE PIECEカードゲーム スタートデッキEX ルフィ&エース【ST-30】（再販分）",
        "バンダイ(BANDAI) ONE PIECEカードゲーム スタートデッキEX ルフィ＆エース【ST-30】"
      ),
    want: true,
  },
  {
    name: "画像: 1語でも十分に特徴的なら借りてよい",
    fn: () => productNameMatches("君臨のヘッドライナー", "遊戯王ラッシュデュエル 君臨のヘッドライナー BOX"),
    want: true,
  },
  {
    name: "画像: 1語で短い商品名は借りない（別商品を指しうる）",
    fn: () => productNameMatches("零式", "8月再販分 機動警察パトレイバー 零式 1/60スケール 色分け済みプラモデル"),
    want: false,
  },
  {
    // 収集元が頭に付ける略号（ACB=アクションベース）は店の商品名に無い。先頭の英数ブロックに
    // 限って1つだけ許す。
    name: "画像: 収集元が頭に付ける略号は一致に要求しない",
    fn: () =>
      productNameMatches(
        "ACB アクションベース 8 [クリアカラー]",
        "バンダイ プラモデル アクションベース8 [クリアカラー] 1/100スケール ACTION BASE"
      ),
    want: true,
  },
  {
    // 実測: 後ろの短い語まで許すと、攻略ガイド本を「Anniversary Set」の写真として借りた。
    name: "画像: 商品名の後ろにある短い語は省略できない（別物を借りてしまう）",
    fn: () =>
      productNameMatches(
        "ONEPIECE カードゲーム 4th Anniversary Set",
        "バンダイ公認 ONE PIECE CARD GAME 4th ANNIVERSARY COMPLETE GUIDE (Vジャンプブックス) カードゲーム"
      ),
    want: false,
  },
  {
    // 2026-08-21: 裏取り済みの略号対応表（TOKEN_EQUIVALENTS）。SDEX＝SDガンダム EXスタンダード。
    // 正規化（長音「ー」落とし）を通した形で比較していることもこのテストが固定する。
    name: "画像: 略号SDEXは店の正式表記（EXスタンダード）と一致してよい",
    fn: () =>
      productNameMatches(
        "SDEX ガンダムエアリアル",
        "SDガンダム EXスタンダード 『機動戦士ガンダム 水星の魔女』 ガンダムエアリアル (プラモデル)"
      ),
    want: true,
  },
  {
    name: "画像: 略号ACVIはARMORED COREの正式表記と一致してよい",
    fn: () =>
      productNameMatches(
        "30MM ACVI SCHNEIDER NACHTREIHER/40E スティールヘイズ",
        "30MM ARMORED CORE VI FIRES OF RUBICON SCHNEIDER NACHTREIHER/40E スティールヘイズ プラモデル"
      ),
    want: true,
  },
  {
    // 対応表はグレード略号の言い換えを許すだけで、**別グレードには相変わらず一致しない**
    // （SDEX の言い換え先が無い候補は、機体名が同じでも借りない）。
    name: "画像: 略号対応はあっても別グレードの出品は借りない",
    fn: () => productNameMatches("SDEX ガンダムエアリアル", "HG 1/144 ガンダムエアリアル 水星の魔女"),
    want: false,
  },
  {
    // 「御三家カードセット」は店側が「カードセット」＋御三家名の列挙で書く。
    // どの御三家かはポケモン名トークンの全語一致が担保する（下の鳴らない側とセット）。
    name: "画像: 御三家カードセットは店の表記（カードセット＋御三家名）と一致してよい",
    fn: () =>
      productNameMatches(
        "ポケモンカード 30th CELEBRATION 御三家カードセット(フシギダネ・ヒトカゲ・ゼニガメ)",
        "10月16日発売 予約 ポケモンカードゲーム MEGA 30th CELEBRATION カードセット フシギダネ・ヒトカゲ・ゼニガメ"
      ),
    want: true,
  },
  {
    name: "画像: 御三家カードセットでも御三家の中身が違えば借りない",
    fn: () =>
      productNameMatches(
        "ポケモンカード 30th CELEBRATION 御三家カードセット(ナエトル・ヒコザル・ポッチャマ)",
        "10月16日発売 予約 ポケモンカードゲーム MEGA 30th CELEBRATION カードセット フシギダネ・ヒトカゲ・ゼニガメ"
      ),
    want: false,
  },
  {
    // 2026-08-21: まとめ見出しの接尾語（nyuka_now）を検索語から剥がす。
    name: "画像: 検索語から「〜の抽選予約・…情報まとめ」の接尾語を落とす",
    fn: () => imgSearchQueryName("ポケモンカード インフェルノXの抽選予約・先着販売・在庫あり・再販入荷情報まとめ"),
    want: "ポケモンカード インフェルノX",
  },
  {
    // 同梱アクセサリの併記（/オフィシャルカードスリーブ）は本体側の出品名に無いので落とす。
    name: "画像: 検索語から末尾の同梱スリーブ併記を落とす",
    fn: () => imgSearchQueryName("ONE PIECEカードゲーム ブースターパック「世界最強の戦士」【OP-17】/オフィシャルカードスリーブ"),
    want: "ONE PIECEカードゲーム ブースターパック「世界最強の戦士」【OP-17】",
  },
  {
    // 「購入券」（購入権の表記ゆれ）も販売条件として落とす。
    name: "画像: 検索語から「再販分 購入券」を落とす",
    fn: () => imgSearchQueryName("ポケモンカードゲーム MEGA 拡張パック「ストームエメラルダ」再販分 購入券"),
    want: "ポケモンカードゲーム MEGA 拡張パック「ストームエメラルダ」",
  },
  {
    // 接尾語剥がしが商品名本体を巻き込まないこと（「予約」で終わる正当な名前ではなく、
    // 途中に販売語を含むだけの名前は触らない）。
    name: "画像: 接尾語剥がしは商品名の途中の語を巻き込まない",
    fn: () => imgSearchQueryName("しゅごキャラ! 20周年原画展 in 東京ソラマチ"),
    want: "しゅごキャラ! 20周年原画展 in 東京ソラマチ",
  },
  {
    // JANは一意識別子。存在しないJANでも楽天は無関係な商品を返すので、
    // 「JANがURL/画像URLに入っていること」を確認できたものだけ使う（＝この関数の一意性判定）。
    name: "画像: 記事に商品コードが2つ以上あるときは特定しない",
    fn: () => extractSoleJan("JAN 4580886840045 と 4582770058406 の2商品"),
    want: null,
  },
  {
    // 各通販への検索リンクが並ぶので、本文の商品コードは何度も出る。関連記事のコードは1〜2回。
    name: "画像: 桁違いに多く出る商品コードはその記事の商品と見なす",
    fn: () =>
      extractSoleJan(
        "4580870991876 4580870991876 4580870991876 4580870991876 サイドバー: 4582770058406"
      ),
    want: "4580870991876",
  },
  {
    name: "画像: 僅差の商品コードでは決めない",
    fn: () => extractSoleJan("4580870991876 4580870991876 4580870991876 4582770058406 4582770058406"),
    want: null,
  },
  {
    name: "画像: 記事の商品コードが1つなら特定する",
    fn: () => extractSoleJan("<a href='https://example.com/search?q=4580886840045'>購入</a> JAN:4580886840045"),
    want: "4580886840045",
  },

  // ── 「直近◯日の新着」の窓（pokemon_goods）──
  // 取り込み側と掲載側が同じ物差しを使うことを固定する。鳴らない側3件・鳴る側1件。
  {
    name: "新着の窓: 登場から30日ちょうどはまだ新着",
    fn: () =>
      isRecentPokemonGoods("登場 2026/07/18", new Date(Date.UTC(2026, 7, 17))),
    want: true,
  },
  {
    name: "新着の窓: 登場から31日は新着ではない（鳴る側）",
    fn: () =>
      isRecentPokemonGoods("登場 2026/07/17", new Date(Date.UTC(2026, 7, 17))),
    want: false,
  },
  {
    // 実測でいちばん古かった行（52日前）。構造的な掃除漏れはここに出る。
    name: "新着の窓: 実測で最古だった52日前は新着ではない",
    fn: () => isRecentPokemonGoods("登場 2026/06/26", new Date(Date.UTC(2026, 7, 17))),
    want: false,
  },
  {
    // 日付が読めないものを消すと、書式が変わった日にソースが丸ごと消える。
    name: "新着の窓: 日付が読めない行は落とさない",
    fn: () => isRecentPokemonGoods("登場 未定", new Date(Date.UTC(2026, 7, 17))),
    want: true,
  },
  {
    name: "新着の窓: 存在しない日付は読まない",
    fn: () => parseAppearedDate("登場 2026/02/30"),
    want: null,
  },

  // ── 観点H（見た目・可読性）: ブランド色のコントラストを CSS の実ファイルで固定する ──
  //
  // audit / audit:page / audit:facts はどれも「文字列」しか見ないので、*読めるか* は
  // 原理的に素通りする。実測（2026-08-17・本番を実際に塗って測定）で、いちばん読ませたい
  // カードの日付が 3.54:1（AA=4.5:1）だった。色を直すだけでは同じことが起きるので、
  // **パレットの下限をここで機械化する**。下の4件は「鳴らない側」3件と「鳴る側」1件。
  {
    name: "観点H: ブランド色600は白いカードの上で AA(4.5:1) を満たす（カードの日付）",
    fn: () => aaOnBrand(BRAND_600, CARD_WHITE),
    want: true,
  },
  {
    name: "観点H: ブランド色600は生成りの地の上でも AA を満たす（ロゴ・フッタのリンク）",
    fn: () => aaOnBrand(BRAND_600, BG_LIGHT),
    want: true,
  },
  {
    name: "観点H: ブランド色600の面に白文字を載せて AA を満たす（🔥本日バッジ・検索ボタン）",
    fn: () => aaOnBrand("#ffffff", BRAND_600),
    want: true,
  },
  {
    // 淡いブランド面（bg-rose-50）。月カレンダーの「商品がある日」がこれで塗ってあり、
    // 地色と白しか見ていなかったときに 4.46:1 を取りこぼした。
    name: "観点H: ブランド色600は淡いブランド面(bg-rose-50)の上でも AA を満たす",
    fn: () => aaOnBrand(BRAND_600, readCssHexToken(GLOBALS_CSS, "color-rose-50")),
    want: true,
  },
  {
    // **鳴る側**: 2026-08-17 まで実際に使っていた色。これが true を返すようになったら、
    // この検査は「何も見ていない」状態に戻っている。
    name: "観点H: 旧ブランド色 #ef5322 は AA を満たさない（検査が落ちられることの確認）",
    fn: () => aaOnBrand("#ef5322", CARD_WHITE),
    want: false,
  },
  {
    name: "観点H: hover用の700は600より暗い（押した感じが出る）",
    fn: () => {
      const a = parseHex(BRAND_700 ?? "");
      const b = parseHex(BRAND_600 ?? "");
      return a !== null && b !== null && relativeLuminance(a) < relativeLuminance(b);
    },
    want: true,
  },
  {
    name: "観点H: CSSからトークンを読めなければ null（読めていないのに緑にしない）",
    fn: () => readCssHexToken("--color-rose-600: var(--x);", "color-rose-600"),
    want: null,
  },

  // ── 観点H その2: 「測ったページの分しか分からない」を塞ぐソース側の検査 ──
  // 実測（2026-08-17）: トップページで 0件 を確認して「0件」と報告したが、/release/* と
  // /items/* に残っていた。さらに ItemBrowser の「該当する商品が見つかりませんでした。」は
  // 絞り込みが0件のときしか描かれないので、どのページを開いても出会えない。
  {
    name: "文字色: ライトで読めないクラスを見つける（鳴る側）",
    fn: () =>
      findLowContrastTextClasses('<p className="text-sm text-neutral-400">x</p>', TAILWIND_TEXT_COLORS)
        .map((h) => h.cls)
        .join(","),
    want: "text-neutral-400",
  },
  {
    name: "文字色: dark: 付きはダーク面で使うので対象外",
    fn: () =>
      findLowContrastTextClasses('<p className="dark:text-neutral-400">x</p>', TAILWIND_TEXT_COLORS).length,
    want: 0,
  },
  {
    name: "文字色: hover: 等の一時状態も対象外",
    fn: () =>
      findLowContrastTextClasses('<a className="hover:text-blue-500">x</a>', TAILWIND_TEXT_COLORS).length,
    want: 0,
  },
  {
    // ライト・ダークを対で書いてあり、どちらの面でも AA を満たす＝鳴ってはいけない。
    // ※ 当初この期待値は `"text-neutral-600 text-neutral-900"`（dark: 無し）で 0 と書いていたが、
    //    検査をダーク面まで見るように広げた時点で**その期待値の方が誤り**になった。
    //    期待値は、規約を変えた日に読み直す（[[System/rules]] 2026-08-16）。
    name: "文字色: 両テーマを対で書いてあれば鳴らない（誤報しない側）",
    fn: () =>
      findLowContrastTextClasses(
        '<p className="text-neutral-900 dark:text-neutral-50">x</p>',
        TAILWIND_TEXT_COLORS
      ).length,
    want: 0,
  },
  {
    // 例外は「そのファイルに限って」効くこと。クラス名だけで例外にすると、
    // いちばん多かった text-neutral-400 がどこに書いても永久に無視される。
    name: "文字色: 例外は指定したファイルでだけ効く",
    fn: () =>
      findLowContrastTextClasses(
        '<span className="text-neutral-400" />',
        TAILWIND_TEXT_COLORS,
        "src/components/FilterBar.tsx"
      ).length,
    want: 0,
  },
  {
    name: "文字色: 同じクラスでも別ファイルなら鳴る（例外が広がっていない）",
    fn: () =>
      findLowContrastTextClasses(
        '<span className="text-neutral-400" />',
        TAILWIND_TEXT_COLORS,
        "src/components/SiteFooter.tsx"
      ).length,
    want: 1,
  },
  {
    name: "文字色: 色見本に無いクラスは判定しない（誤報より取りこぼしを選ぶ）",
    fn: () => findLowContrastTextClasses('<p className="text-lime-400">x</p>', TAILWIND_TEXT_COLORS).length,
    want: 0,
  },
  {
    // **鳴る側**: 2026-08-17 に自分で作った退行そのもの。ライトを直すために濃くしたが
    // dark: を書かなかったので、ダークで 2.49:1 に沈んだ（本番で7件）。
    name: "文字色: dark: の無い濃い色はダークで沈むので鳴る",
    fn: () =>
      findLowContrastTextClasses('"py-1 font-semibold text-neutral-600"', TAILWIND_TEXT_COLORS)
        .map((h) => h.theme)
        .join(","),
    want: "dark",
  },
  {
    name: "文字色: dark: を対で書けば鳴らない",
    fn: () =>
      findLowContrastTextClasses(
        '"py-1 font-semibold text-neutral-600 dark:text-neutral-400"',
        TAILWIND_TEXT_COLORS
      ).length,
    want: 0,
  },
  {
    // 判定の単位はリテラル1つ。ファイル単位で「どこかに dark: があるか」を見る作りだと、
    // 同じファイルの別の行の dark: に助けられて上の事故を見逃す（実際そうなっていた）。
    name: "文字色: 同じファイルの別リテラルの dark: には助けられない",
    fn: () =>
      findLowContrastTextClasses(
        '"text-neutral-700 dark:text-neutral-300" ... "py-1 text-neutral-600"',
        TAILWIND_TEXT_COLORS
      ).length,
    want: 1,
  },

  // ── 2026-08-18 追加の一次ストア6ソース ────────────────────────────────────
  // 「載せる基準」と「精度を足さない」の2点だけを固定する。どちらも実データで一度間違えた。

  // メディコム・トイ: 商品名が <br> で複数行に割れている（BAPEコラボ）。先頭行だけ採ると
  // **商品名が途中で切れたカード**になる。実測でそうなっていた。
  {
    name: "medicom: 商品名が2行に割れていても繋ぐ",
    fn: () =>
      parseMedicomDetail(
        `<div id="p_descrip">2026年10月発売予定<br>MCT 30th ANNIV. BAPE(R) CAMO<br>REVERSIBLE BE@R SHARK FULL ZIP HOODIE<br><br>頒布価格各￥62,700（税込）<br>●サイズ：S/M/L</div>`
      ).name,
    want: "MCT 30th ANNIV. BAPE(R) CAMO REVERSIBLE BE@R SHARK FULL ZIP HOODIE",
  },
  {
    name: "medicom: 「頒布価格各￥」も価格として読む",
    fn: () =>
      parseMedicomDetail(
        `<div id="p_descrip">2026年10月発売予定<br>X<br><br>頒布価格各￥62,700（税込）</div>`
      ).price,
    want: "62,700円",
  },
  {
    // 日が書いてあるのに月精度扱いすると、カードに「10/1」という実在しない発売日が出る（ミス15）。
    name: "medicom: 日まで書いてあれば日を読む",
    fn: () =>
      parseMedicomDetail(`<div id="p_descrip">2026年7月25日発売予定<br>X<br><br>頒布価格￥100（税込）</div>`).day,
    want: 25,
  },
  {
    name: "medicom: 日が無ければ日を作らない",
    fn: () =>
      parseMedicomDetail(`<div id="p_descrip">2026年10月発売・発送予定<br>X<br><br>頒布価格￥100（税込）</div>`).day,
    want: null,
  },

  // 月精度の予定日: 当月は月初がもう過去なので、日付を作らず null にする
  // （月初を入れると「eventDate < today」で今月の新商品が丸ごと消える）。
  {
    name: "月精度: 月初が未来ならその日",
    fn: () => monthPlanDate(2026, 10, new Date(Date.UTC(2026, 7, 18)))?.toISOString().slice(0, 10),
    want: "2026-10-01",
  },
  {
    name: "月精度: 当月（月初は過去）は日付を作らない",
    fn: () => monthPlanDate(2026, 8, new Date(Date.UTC(2026, 7, 18))),
    want: null,
  },

  // タカラトミーモール
  {
    name: "タカラトミー: 「2026年11月21日」は日まで読む",
    fn: () => parseTakaraTomyRelease("2026年11月21日").date?.toISOString().slice(0, 10),
    want: "2026-11-21",
  },
  {
    name: "タカラトミー: 「2026年9月中旬」は日を作らず月精度テキストを残す",
    fn: () => parseTakaraTomyRelease("2026年9月中旬").text,
    want: "2026年9月中旬",
  },
  {
    // 収集元が「抽選に応募する」と書いている時だけ抽選と言う（推測で抽選にしない）。
    name: "タカラトミー: 「抽選に応募する」だけを抽選と呼ぶ",
    fn: () =>
      takaraTomyEventType({
        labels: ["NEW", "予約"],
        action: "抽選に応募する",
      } as TakaraTomyCard),
    want: "抽選",
  },
  {
    name: "タカラトミー: 「予約する」は抽選ではない",
    fn: () => takaraTomyEventType({ labels: ["NEW", "予約"], action: "予約する" } as TakaraTomyCard),
    want: "予約",
  },
  {
    name: "タカラトミー: 再入荷ラベルは再販",
    fn: () => takaraTomyEventType({ labels: ["再入荷"], action: "カートに入れる" } as TakaraTomyCard),
    want: "再販",
  },
  // 🚨 2026-08-19 実測: 一覧のボタンには「予約期間終了」28件・「販売期間終了」10件・
  //    「在庫なし」36件がある。`/予約/` で判定していたので**「予約期間終了」も『予約』**になり、
  //    受注の終わった商品を予約として掲載していた（238件中59件・25%）。
  //    リンク先には「予約期間は終了しました。」と書いてある。
  {
    name: "タカラトミー: 「予約期間終了」は買えない（予約と読まない）",
    fn: () => takaraTomyUnavailable("予約期間終了"),
    want: true,
  },
  {
    name: "タカラトミー: 「予約期間終了」を eventType でも予約にしない",
    fn: () => takaraTomyEventType({ labels: ["オリジナル"], action: "予約期間終了" } as TakaraTomyCard),
    want: "発売",
  },
  {
    name: "タカラトミー: 「販売期間終了」「在庫なし」「入荷案内申込」も買えない",
    fn: () =>
      ["販売期間終了", "在庫なし", "入荷案内申込"].every((a) => takaraTomyUnavailable(a)),
    want: true,
  },
  {
    name: "タカラトミー: 買える状態のボタンは落とさない（巻き添えを出さない）",
    fn: () =>
      ["予約する", "カートに入れる", "カートに入れる（残りわずか！）", "抽選に応募する"].some((a) =>
        takaraTomyUnavailable(a),
      ),
    want: false,
  },
  {
    name: "タカラトミー: ポケモン玩具はポケモンジャンル",
    fn: () => takaraTomyGenre("ポケットモンスター 超連動!ポケモン メガリングZ"),
    want: "ポケモン",
  },
  { name: "タカラトミー: トミカは玩具ジャンル", fn: () => takaraTomyGenre("トミカ ギフトセット"), want: "玩具" },

  // ── 画像を取りようがないリンク先（2026-08-19）──────────────────────
  // 実測: nyuka_now の画像付与率が 95%→61% に落ちて「壊れた」ように見えたが、
  // 画像なし30件のうち **28件がAmazonへのリンク**＝方針として採らないと決めている先だった。
  // 率の母数に入れたままだと、次に見た人（や自分）が方針を覆して取りに行こうとする。
  {
    name: "画像: Amazonの商品ページからは取らない（借りてよい根拠が無い）",
    fn: () => cannotSourceImage("https://www.amazon.co.jp/dp/B0H7VPGMPJ"),
    want: true,
  },
  {
    name: "画像: 応募フォームには商品画像が無い",
    fn: () => cannotSourceImage("https://docs.google.com/forms/d/e/abc/viewform"),
    want: true,
  },
  {
    // 鳴らない側。一次ストアは普通に取れるので母数から外さない。
    name: "画像: 一次ストアの商品ページは取れる側",
    fn: () => cannotSourceImage("https://takaratomymall.jp/shop/g/g4904810066729/"),
    want: false,
  },
  {
    // amazon を含むだけの別ホストを巻き込まない（ホストで解く）。
    name: "画像: ホスト名で判定する（amazonを含む別ドメインを巻き込まない）",
    fn: () => cannotSourceImage("https://not-amazon.co.jp.example.com/item/1"),
    want: false,
  },
  { name: "画像: 壊れたURLは判定しない", fn: () => cannotSourceImage("not a url"), want: false },

  // ── 画面に出すURLの裏取り（2026-08-19）──────────────────────────
  // 実測 #92479: 「ポケモンカードゲーム MEGA 30th CELEBRATION プレミアムデッキセット」の
  // item.url が**ヤマダデジタル会員アプリの説明ページ**（本文476字・商品名なし）だった。
  // preferredStoreUrl は店舗ドメインを最優先するので、汎用ページでも1位になってしまう。
  {
    name: "URL裏取り: 載っていると確かめたページを最優先",
    fn: () =>
      chooseVerifiedUrl([
        { url: "https://yamada.example/kaiin", verdict: "mismatch" },
        { url: "https://aeon.example/lottery", verdict: "ok" },
        { url: "https://x.com/a/status/1", verdict: "unknown" },
      ]),
    want: "https://aeon.example/lottery",
  },
  {
    // **分からないことを、外れの根拠にしない。** 開けないX告知は、商品が載っていないと
    // 分かった店舗ページより優先する。
    name: "URL裏取り: 確かめられないURLは、載っていないと分かったURLより優先",
    fn: () =>
      chooseVerifiedUrl([
        { url: "https://yamada.example/kaiin", verdict: "mismatch" },
        { url: "https://x.com/a/status/1", verdict: "unknown" },
      ]),
    want: "https://x.com/a/status/1",
  },
  {
    name: "URL裏取り: 全部外れなら元の順の先頭に留める（URLを空にしない）",
    fn: () =>
      chooseVerifiedUrl([
        { url: "https://a.example/x", verdict: "mismatch" },
        { url: "https://b.example/y", verdict: "mismatch" },
      ]),
    want: "https://a.example/x",
  },
  { name: "URL裏取り: 候補が無ければ null", fn: () => chooseVerifiedUrl([]), want: null },
  {
    // 実測: 「ポケモンカード デッキビルドBOX 黒炎の支配者」の候補で、ポケカ全般の告知ページは
    // 「ポケモンカード」1語しか当たらない。2値で選ぶと弱い一致が1位になるので、数の多い方を採る。
    name: "URL裏取り: 載っている候補が複数なら、識別語が多く当たった方を採る",
    fn: () =>
      chooseVerifiedUrl([
        { url: "https://weak.example/news", verdict: "ok", score: 1 },
        { url: "https://strong.example/item", verdict: "ok", score: 3 },
      ]),
    want: "https://strong.example/item",
  },
  {
    name: "URL裏取り: 同点なら先に見た方（＝店舗ドメイン優先の順）を保つ",
    fn: () =>
      chooseVerifiedUrl([
        { url: "https://a.example/x", verdict: "ok", score: 2 },
        { url: "https://b.example/y", verdict: "ok", score: 2 },
      ]),
    want: "https://a.example/x",
  },
  {
    name: "識別語: 当たった数を数える",
    fn: () =>
      identityMatchCount(
        normalizeForSearch("30th CELEBRATION プレミアムデッキセット 抽選"),
        "ポケモンカードゲーム MEGA 30th CELEBRATION プレミアムデッキセット エーフィ"
      ),
    want: 3,
  },
  {
    // 開いても中身が分からない先は取りに行かない（JSで描くフォーム・ログイン必須のX）。
    name: "URL裏取り: Googleフォームは読めないURL",
    fn: () => isUnreadableUrl("https://docs.google.com/forms/d/e/abc/viewform"),
    want: true,
  },
  { name: "URL裏取り: X告知は読めないURL", fn: () => isUnreadableUrl("https://x.com/foo/status/1"), want: true },
  {
    name: "URL裏取り: 店舗ドメインは読めるURL",
    fn: () => isUnreadableUrl("https://www.yamada-denki.jp/service/pointservice/digital-kaiin.html"),
    want: false,
  },
  {
    // 並び順は preferredStoreUrl と同じ＝店舗ドメイン＞フォーム＞X告知。
    name: "URL裏取り: 候補は店舗ドメイン＞フォーム＞X告知の順に見る",
    fn: () =>
      orderedStoreUrls([
        { url: "https://x.com/a/status/1" },
        { url: "https://docs.google.com/forms/d/e/a/viewform" },
        { url: "https://shop.example/item/1" },
      ]).join(","),
    want: "https://shop.example/item/1,https://docs.google.com/forms/d/e/a/viewform,https://x.com/a/status/1",
  },
  // ── 識別語（取り込み側と検査側で同じ物差しを使う） ──
  {
    // ヤマダの会員説明ページには商品名が1語も無い＝載っていない。
    name: "識別語: 商品名の語が1つも無いページは「載っていない」",
    fn: () =>
      pageShowsProduct(
        normalizeForSearch("ヤマダデジタル会員アプリ ポイントサービスのご案内"),
        "ポケモンカードゲーム MEGA 30th CELEBRATION プレミアムデッキセット エーフィ"
      ),
    want: false,
  },
  {
    name: "識別語: 商品名の語が出ていれば「載っている」",
    fn: () =>
      pageShowsProduct(
        normalizeForSearch("30th CELEBRATION プレミアムデッキセット 抽選販売のお知らせ"),
        "ポケモンカードゲーム MEGA 30th CELEBRATION プレミアムデッキセット エーフィ"
      ),
    want: true,
  },
  {
    // 作品名は日英・カナで割れる。エイリアス表を通すので正しいリンクを外さない。
    name: "識別語: 作品名の表記ゆれ（ワンピースカードゲーム）でも当てる",
    fn: () =>
      pageShowsProduct(normalizeForSearch("ワンピースカードゲーム 予約受付"), "ONE PIECE カードゲーム 新たなる皇帝"),
    want: true,
  },
  {
    // 実測 #91634: こちらの掲載名は「ジェラートピケ」、Amazon の商品名は「ジェラート ピケ」。
    // 同じ商品なのに「リンク先に商品が見当たらない」と誤報していた（＝一次情報を嘘だと言う側の誤り）。
    name: "識別語: 空白の入り方が違っても同じ商品と読む",
    fn: () =>
      pageShowsProduct(
        normalizeForSearch("[ジェラート ピケ] 【ドラゴンクエスト】ポーチ PWGB264609"),
        "ジェラートピケ・アイテム各種"
      ),
    want: true,
  },
  {
    // 識別語が1語しか無い名前は、一致しなくても「載っていない」と言い切れない。
    name: "識別語: 1語しか無い商品名は判定しない",
    fn: () => canJudgeIdentity("amiibo"),
    want: false,
  },

  // ── 価格の読み取り（2026-08-19）──────────────────────────────
  // 実測: `/\d{2,7}/` で切っていたので、8桁以上の価格が**途中で切れて別の数**になっていた。
  // `audit:links` が「掲載価格 16,000,000円 が一次情報に無い」と誤報した原因＝
  // 手元が 1,600,000 になっていて、収集元の 16,000,000 と一致しなかった（正しい価格を嘘だと言った）。
  {
    name: "価格: 8桁の価格を途中で切らない（16,000,000円）",
    fn: () => parseYen("16,000,000円"),
    want: 16000000,
  },
  {
    // 13桁のJANは価格ではない。以前は先頭7桁を拾って 4,904,810円 という存在しない価格になった。
    name: "価格: 13桁のJANは価格として読まない",
    fn: () => parseYen("4904810066729"),
    want: null,
  },
  { name: "価格: 税込表記から読む", fn: () => parseYen("2,970円(税込)"), want: 2970 },
  { name: "価格: ¥表記から読む", fn: () => parseYen("¥18,700"), want: 18700 },
  {
    // 「1BOX(20パック)¥3,960」＝紛れの中から最大値を採る（元からの仕様）。
    name: "価格: 紛れがあっても最大の数を採る",
    fn: () => parseYen("1BOX(20パック)¥3,960"),
    want: 3960,
  },
  { name: "価格: 数字が無ければ null", fn: () => parseYen("価格未定"), want: null },

  // ── 基準に書いてよい回か（2026-08-19）──────────────────────────
  // 実測: 同じ日に全件突合を2回回したら、1回目は判定不能24/突合844、
  // 2回目は**判定不能198(23%)/突合670**（こちらから叩きすぎて収集元が絞った）。
  // 2回目の要確認は15件＝1件少ないが、**直ったのではなく読めなかった**だけ。
  // 比較側には「突合できた件数が半減」の歯止めがあるのに、**書き込み側には無かった**。
  {
    name: "基準: 判定不能が少ない回は書いてよい（実測1回目 24/868）",
    fn: () => baselineWritable(844, 24).ok,
    want: true,
  },
  {
    name: "基準: 判定不能が23%の痩せた回は書かない（実測2回目 198/868）",
    fn: () => baselineWritable(670, 198).ok,
    want: false,
  },
  {
    name: "基準: ちょうど20%は書いてよい（境目を閉じない）",
    fn: () => baselineWritable(80, 20).ok,
    want: true,
  },
  {
    name: "基準: 1件も読めなかった回は書かない",
    fn: () => baselineWritable(0, 50).ok,
    want: false,
  },
  {
    // 0件同士で NaN にしない（割り算の分母が0）。
    name: "基準: 対象0件でも例外にしない",
    fn: () => baselineWritable(0, 0).ok,
    want: true,
  },

  // ── タカラトミー: 商品ページ側の「終了」判定（2026-08-19）────────────────
  // 実測で**3回とも嘘をつかれた**型を、鳴らない側として固定する。
  // どれも「画面上は正常」なので、外した瞬間に静かに誤検知が戻る。
  {
    // ①終了の文言はコメントで先に書いてある。期間が終わったらコメントを外す作り。
    // 実測: 受付中の g4904810066729（予約期間 8/5〜9/9）がこれで終了と数えられた。
    name: "タカラトミー: コメントで先書きされた終了文は根拠にしない",
    fn: () =>
      takaraTomyEndedEvidence(
        '<div class="note_"><h2>予約期間:2026年8月5日(水)00:00 ～ 2026年9月9日(水)23:59</h2>' +
          "<!--<h2>予約期間は終了しました。たくさんのご注文ありがとうございました。</h2>-->" +
          "</div><button>予約する</button>"
      ),
    want: null,
  },
  {
    // ②「※予約期間終了後の販売につきましては…」は受付中のページにも出る定型文。
    // 実測: ブロッキーズ9件（予約期間 8/1〜8/30＝受付中）がこれで巻き込まれた。
    name: "タカラトミー: 「予約期間終了後の販売は未定」の定型文は根拠にしない",
    fn: () =>
      takaraTomyEndedEvidence(
        "<p>※予約期間終了後の販売につきましては、現在のところ未定です</p><button>予約する</button>"
      ),
    want: null,
  },
  {
    // ③同じページに別商品が並ぶ。隣の商品の状態を自分の状態として読まない（#75430 と同じ型）。
    name: "タカラトミー: カルーセルの別商品の「予約期間終了」は根拠にしない",
    fn: () =>
      takaraTomyEndedEvidence(
        "<button>予約する</button>" +
          '<div class="goods_carousel__checkBox"><p class="stock_ line1_">予約期間終了</p></div>'
      ),
    want: null,
  },
  {
    name: "タカラトミー: 受付中のページは終了と言わない",
    fn: () => takaraTomyEndedEvidence('<button class="tt_button4-1">予約する</button>'),
    want: null,
  },
  {
    // 鳴る側①: 自分の申込ボタンが disabled。実測 27件すべてがこの形だった。
    name: "タカラトミー: 自分のボタンが disabled なら終了",
    fn: () =>
      !!takaraTomyEndedEvidence(
        '<button class="tt_button4-1 tt_reservation" disabled>予約期間終了</button>'
      ),
    want: true,
  },
  {
    // 鳴る側②: 在庫欄。
    name: "タカラトミー: 在庫欄が「予約期間終了」なら終了",
    fn: () =>
      !!takaraTomyEndedEvidence('<td id="spec_stock_msg"> 予約期間終了<br>※受注期間終了後の販売…</td>'),
    want: true,
  },
  {
    // 鳴る側③: コメントを外した完了文（①と同じ文だが、コメントの外に出ている）。
    name: "タカラトミー: コメントの外に出た完了文なら終了",
    fn: () =>
      !!takaraTomyEndedEvidence(
        '<div class="note_"><h2><del>予約期間:2026年8月5日 ～ 2026年8月18日</del></h2>' +
          "<h2>予約期間は終了しました。たくさんのご注文ありがとうございました。</h2></div>"
      ),
    want: true,
  },

  // BILLY'S LAUNCH
  {
    // 収集元に「¥018,700」という先頭0付きの表記が実在する（MIZUNO WAVE MUSTANG LS）。
    // そのまま出すと価格が嘘になる。
    name: "BILLY'S: 「¥018,700」を18,700円として読む",
    fn: () =>
      parseBillysLaunch(
        `<ul class="c-launchlist__list"><li><div class="c-itembox__cat">MIZUNO</div><div class="c-itembox__goodsname">WAVE MUSTANG LS</div><div class="c-price__default">¥018,700<br>予約受付中</div><div class="c-launchlist__date"><span>8/21</span></div></li></ul>`
      )[0]?.price,
    want: "18,700円",
  },
  {
    name: "BILLY'S: 「予約受付中」が無ければ予約と言わない",
    fn: () =>
      parseBillysLaunch(
        `<ul class="c-launchlist__list"><li><div class="c-itembox__cat">NB</div><div class="c-itembox__goodsname">U991WL2</div><div class="c-price__default">¥42,900</div><div class="c-launchlist__date"><span>8/20</span></div></li></ul>`
      )[0]?.preorder,
    want: false,
  },

  {
    // 実測 2026-08-19（audit title_pipe_residue が ERROR）: 収集元のブランド欄が
    // `CONVERSE | PURPLE THINGS`（コラボ）で、区切り記号がそのままタイトルに残っていた。
    name: "BILLY'S: コラボの「A | B」は「A × B」にする（記号を残さない・消さない）",
    fn: () =>
      parseBillysLaunch(
        `<ul class="c-launchlist__list"><li><div class="c-itembox__cat">CONVERSE | PURPLE THINGS</div><div class="c-itembox__goodsname">ALL STAR LGCY SU HI</div><div class="c-price__default">¥20,900</div><div class="c-launchlist__date"><span>8/25</span></div></li></ul>`
      )[0]?.brand,
    want: "CONVERSE × PURPLE THINGS",
  },
  {
    name: "BILLY'S: 単独ブランドは触らない",
    fn: () => normalizeBillysBrand("SALOMON"),
    want: "SALOMON",
  },
  {
    name: "BILLY'S: 全角パイプ・前後の空白ゆれも同じ形にする",
    fn: () => normalizeBillysBrand("  asics｜KIKO KOSTADINOV  "),
    want: "asics × KIKO KOSTADINOV",
  },

  // ちいかわマーケット: コレクション名＝日付＋種別
  { name: "ちいかわ: 20260807 は発売", fn: () => parseChiikawaCollection("20260807")?.kind, want: "発売" },
  { name: "ちいかわ: pre20260724 は予約", fn: () => parseChiikawaCollection("pre20260724")?.kind, want: "予約" },
  { name: "ちいかわ: re20260805 は再販", fn: () => parseChiikawaCollection("re20260805")?.kind, want: "再販" },
  { name: "ちいかわ: newitems は日付コレクションではない", fn: () => parseChiikawaCollection("newitems"), want: null },
  {
    // classifyGenre は「ぬいぐるみ」をフィギュアに倒すが、ここは全件キャラクターグッズ。
    name: "ちいかわ: ぬいぐるみはキャラグッズ（フィギュアに倒さない）",
    fn: () => chiikawaGenre("ぬいぐるみ", "ちいかわ ひっかけぬいぐるみ"),
    want: "キャラグッズ",
  },
  { name: "ちいかわ: ソフビはソフビ・アートトイ", fn: () => chiikawaGenre("フィギュア", "おっきいソフビフィギュア"), want: "ソフビ・アートトイ" },

  // POP MART: businessType→種別と、URLの組み立て（slug/idの順を逆にするとSPAは200のまま
  // 中身の無いページを出す＝HTTPでは検出できないので、形をここで固定する）
  { name: "POP MART: shop は発売", fn: () => popmartEventType("shop"), want: "発売" },
  { name: "POP MART: draw は抽選", fn: () => popmartEventType("draw"), want: "抽選" },
  { name: "POP MART: 未知のbusinessTypeは発売に倒す（抽選と断定しない）", fn: () => popmartEventType(undefined), want: "発売" },
  {
    name: "POP MART: 商品URLは /products/<slug>/<id> の順",
    fn: () => popmartProductUrl("shop", "labubu-series", "abc-123"),
    want: "https://www.popmart.com/jp/products/labubu-series/abc-123",
  },
  {
    name: "POP MART: 抽選は /pop-now/box-set/ 配下",
    fn: () => popmartProductUrl("draw", "labubu-series", "abc-123"),
    want: "https://www.popmart.com/jp/pop-now/box-set/labubu-series/abc-123",
  },
  {
    name: "POP MART: slugが『-』だけの行はidだけでURLを作る（実在する形）",
    fn: () => popmartProductUrl("shop", "-", "abc-123"),
    want: "https://www.popmart.com/jp/products/abc-123",
  },
  {
    name: "POP MART: 画像は一覧サムネ(ja)を最優先で借りる",
    fn: () => popmartImage({ npcImages_trans: { ja: "https://x/npc.jpg" }, bannerImages: [{ link_trans: { "en-us": "https://x/b.jpg" } }] }),
    want: "https://x/npc.jpg",
  },
  {
    name: "POP MART: サムネが無ければバナーの最初の実URL（空文字はスキップ）",
    fn: () => popmartImage({ npcImages_trans: {}, bannerImages: [{ link_trans: { ja: "", "en-us": "https://x/b.jpg" } }] }),
    want: "https://x/b.jpg",
  },
  {
    name: "POP MART: どこにも画像が無ければ null（推測画像を付けない）",
    fn: () => popmartImage({ npcImages_trans: {}, bannerImages: [] }),
    want: null,
  },

  // ── 日付別コレクション型Shopifyストア（ちいかわ/ナガノ/mofusand 共通・2026-08-21） ──
  // mofusand は suffix型（20251010re）や枝番（20251128-2）を使う（実測）。
  { name: "キャラEC: 20260821 は発売", fn: () => parseDatedCollectionHandle("20260821")?.kind, want: "発売" },
  { name: "キャラEC: pre20260826 は予約", fn: () => parseDatedCollectionHandle("pre20260826")?.kind, want: "予約" },
  { name: "キャラEC: suffix型 20251010re も再販", fn: () => parseDatedCollectionHandle("20251010re")?.kind, want: "再販" },
  { name: "キャラEC: 枝番 20251128-2 は日付そのまま発売", fn: () => parseDatedCollectionHandle("20251128-2")?.date?.toISOString().slice(0, 10), want: "2025-11-28" },
  { name: "キャラEC: 語尾つき 20250124-plush も読める", fn: () => parseDatedCollectionHandle("20250124-plush")?.kind, want: "発売" },
  { name: "キャラEC: 13月は日付コレクションではない", fn: () => parseDatedCollectionHandle("20261301"), want: null },
  {
    // ナガノ実物: 種別タグと**3連続の運用注記【…】**をタイトルから剥がし、発送注記は eventDateText に移す
    name: "キャラEC: 【予約】と連続する運用注記【…】を剥がす",
    fn: () =>
      splitCharaStoreTitle(
        "【予約】ナガノキャラクターズ ハッピーバッグ2027（未年）【2026年12月中旬より順次発送予定（発送延期の場合もキャンセル不可）】【通常商品と同時購入・配送希望日指定不可】【キャンペーン対象外】"
      )[0],
    want: "ナガノキャラクターズ ハッピーバッグ2027（未年）",
  },
  {
    name: "キャラEC: 連続注記の中でも発送時期の注記が eventDateText に残る",
    fn: () =>
      splitCharaStoreTitle(
        "【予約】A【2026年12月中旬より順次発送予定（発送延期の場合もキャンセル不可）】【キャンペーン対象外】"
      )[1],
    want: "2026年12月中旬より順次発送予定（発送延期の場合もキャンセル不可）",
  },
  {
    name: "キャラEC: 剥がした発送注記は捨てずに返す（eventDateText 行き）",
    fn: () => splitCharaStoreTitle("【予約】A【2026年12月中旬より順次発送予定】")[1],
    want: "2026年12月中旬より順次発送予定",
  },
  {
    name: "キャラEC: 発送系でない【】は商品名の一部として残す",
    fn: () => splitCharaStoreTitle("mofusand ぬいぐるみ【サメにゃん】")[0],
    want: "mofusand ぬいぐるみ【サメにゃん】",
  },
  { name: "キャラEC: ぬいぐるみはキャラグッズ（フィギュアに倒さない）", fn: () => charaStoreGenre("ぬいぐるみ", "くま ふわもち抱っこぬいぐるみ"), want: "キャラグッズ" },
  { name: "キャラEC: ソフビはソフビ・アートトイ", fn: () => charaStoreGenre("フィギュア", "おっきいソフビフィギュア"), want: "ソフビ・アートトイ" },

  // ── ガンダムカードゲーム公式（2026-08-21） ──
  {
    name: "ガンダム公式: mvBox から 商品名/日付/価格/リンク を読む",
    fn: () => {
      const html =
        '<div class="mvBox"><div class="mvIllust"><img src="../images/products/index/mv/st14/sp.jpg" alt="ST14"></div>' +
        '<div class="category">スタートデッキ</div><div class="number">[ST14]</div><h2 class="title">Heavy Dominion</h2>' +
        '<div class="mvLeftText"><div class="date">2026.9.26</div><div class="price">メーカー希望小売価格：￥1,650(税込)</div></div>' +
        '<div class="btnCol"><a href="st14.html" class="btn">この商品を見る</a></div></div>';
      const b = parseGundamProducts(html)[0];
      return `${b?.number}|${b?.title}|${b?.dateText}|${b?.price}|${b?.url}`;
    },
    want: "ST14|Heavy Dominion|2026.9.26|1,650円（税込）|https://www.gundam-gcg.com/jp/products/st14.html",
  },
  { name: "ガンダム公式: 商品ブロックの無いHTMLは0件（→scraperがthrowして赤くする）", fn: () => parseGundamProducts("<html><body>menu</body></html>").length, want: 0 },
  { name: "ガンダム公式: 2026.9.26 は暦日になる", fn: () => parseGundamDate("2026.9.26", new Date(Date.UTC(2026, 7, 21)))?.toISOString().slice(0, 10), want: "2026-09-26" },
  {
    // 月精度は monthPlanDate の規約（月初が過ぎていれば null＝日付未定。その月のどこかの日を作らない）
    name: "ガンダム公式: 月だけの 2026.8 は当月途中なら日付未定",
    fn: () => parseGundamDate("2026.8", new Date(Date.UTC(2026, 7, 21))),
    want: null,
  },

  // ── hololive公式ショップ（2026-08-21） ──
  {
    // 実物のマークアップ: <section class="Pdt_shipping"><p><span class="shipping_ttl">受注受付期間</span> : A ～ B</p>
    name: "ホロライブ: 受注受付期間の締切（後ろの日付）を読む",
    fn: () =>
      parseHoloSchedule(
        '<section class="Pdt_shipping"><p><span class="shipping_ttl">受注受付期間</span> : 2026年08月20日 20時00分 ～ 2026年09月24日 18時00分</p><span class="shipping_ttl">発送予定日</span>：2027年03月下旬までに発送</section>'
      ).periodEnd?.toISOString().slice(0, 10),
    want: "2026-09-24",
  },
  {
    name: "ホロライブ: 文言はそのまま保存する（date_text 突合の相手）",
    fn: () =>
      parseHoloSchedule(
        '<p><span class="shipping_ttl">受注受付期間</span> : 2026年08月20日 20時00分 ～ 2026年09月24日 18時00分</p>'
      ).periodRaw,
    want: "2026年08月20日 20時00分 ～ 2026年09月24日 18時00分",
  },
  {
    // 予約販売（期間なし）: 発送予定月が未来なら月初を予定日に
    name: "ホロライブ: 期間なしは発送予定月（未来なら月初）",
    fn: () =>
      parseHoloSchedule('<span class="shipping_ttl">発送予定日</span>：2026年09月中旬までに発送')
        .shipMonthDate(new Date(Date.UTC(2026, 7, 21)))
        ?.toISOString()
        .slice(0, 10),
    want: "2026-09-01",
  },
  {
    name: "ホロライブ: 発送予定月の月初が過ぎていれば日付未定（過去日を作らない）",
    fn: () =>
      parseHoloSchedule('<span class="shipping_ttl">発送予定日</span>：2026年08月中旬までに発送').shipMonthDate(
        new Date(Date.UTC(2026, 7, 21))
      ),
    want: null,
  },
  { name: "ホロライブ: 期間の無いページは締切を作らない", fn: () => parseHoloSchedule("<html></html>").periodEnd, want: null },
  { name: "ホロライブ: 受注生産商品タグは予約扱い", fn: () => isHoloPreorder(["Group_ホロライブ", "受注生産商品"]), want: true },
  { name: "ホロライブ: タレントタグだけなら在庫販売", fn: () => isHoloPreorder(["Talent_大神ミオ"]), want: false },
  {
    // images[0] は告知バナー（banner名→汎用画像判定に落ちる）のことが多い。商品写真＝
    // 汎用判定に落ちない最初の1枚を選ぶ（実測: 250商品中136枚が banner 名で画像なしになっていた）
    name: "ホロライブ: バナー画像を飛ばして商品写真を選ぶ",
    fn: () =>
      holoImage([
        { src: "https://cdn.shopify.com/s/files/1/x/holo_OCG_banner_JP_260807.png" },
        { src: "https://cdn.shopify.com/s/files/1/x/item_photo_01.png" },
      ]),
    want: "https://cdn.shopify.com/s/files/1/x/item_photo_01.png",
  },
  {
    name: "ホロライブ: 全部バナー名でも**他店のCDN**なら null（推測画像を付けない）",
    fn: () => holoImage([{ src: "https://cdn.shopify.com/s/files/1/x/holo_A_banner_JP.png" }]),
    want: null,
  },
  {
    // この店は商品写真まで banner と命名する（実測136/250枚）。ホロライブ店のCDNパスに限り
    // banner 語は汎用の根拠にしない（例外はホストとセットで持つ）。
    name: "ホロライブ: 自店CDNの banner 名は商品写真として採る",
    fn: () => holoImage([{ src: "https://cdn.shopify.com/s/files/1/0529/2641/5045/files/holo_RO_badge_banner_JP_260723.png" }]),
    want: "https://cdn.shopify.com/s/files/1/0529/2641/5045/files/holo_RO_badge_banner_JP_260723.png",
  },
  {
    name: "ホロライブ: 自店CDNでも no-image 等の汎用判定は生きている",
    fn: () => holoImage([{ src: "https://cdn.shopify.com/s/files/1/0529/2641/5045/files/no-image.png" }]),
    want: null,
  },
  { name: "ホロライブ: ホロカはトレカ", fn: () => holoGenre("hololive OFFICIAL CARD GAME ブースターパック"), want: "トレカ" },
  {
    // 実測: 商品名「ブースターパック…」に5,280円が付き price_unit_suspect が鳴った。
    // 実体は variant が「（BOX：12パック入り）」のBOX売り＝販売単位を商品名に足す。
    name: "ホロライブ: variantがBOXなら商品名に販売単位を足す",
    fn: () => holoTitleWithUnit("ブースターパック「ボリュームヴォルテックス」", "グッズ / ブースターパック「ボリュームヴォルテックス」（BOX：12パック入り）"),
    want: "ブースターパック「ボリュームヴォルテックス」（BOX：12パック入り）",
  },
  {
    name: "ホロライブ: 既にBOXと書いてある商品名には重ねない",
    fn: () => holoTitleWithUnit("ブースターパック BOXセット", "グッズ（BOX：12パック入り）"),
    want: "ブースターパック BOXセット",
  },
  {
    name: "ホロライブ: variantに単位が無ければ何も足さない",
    fn: () => holoTitleWithUnit("アクリルスタンド", "Default Title"),
    want: "アクリルスタンド",
  },
  {
    // 実測: onepiece_card と torecamap が同じ /products/boosters/op17/ を指してカードが2枚並んだ。
    // 公式の3段パスも個別商品ページとして同一性キーにする（他ホストの3段は適用しない）。
    name: "URL同一性: ONE PIECE公式の3段パスもキーになる",
    fn: () => productUrlKey("https://www.onepiece-cardgame.com/products/boosters/op17/"),
    want: "www.onepiece-cardgame.com/products/boosters/op17",
  },
  {
    name: "URL同一性: 知らないホストの3段パスはキーにしない（誤マージ防止）",
    fn: () => productUrlKey("https://example.com/products/boosters/op17/"),
    want: null,
  },
  { name: "ホロライブ: figma はフィギュア", fn: () => holoGenre("figma 猫又おかゆ"), want: "フィギュア" },
  { name: "ホロライブ: アクリルスタンドはキャラグッズ", fn: () => holoGenre("大神ミオ 誕生日記念2026 アクリルスタンド"), want: "キャラグッズ" },

  // ── ポケモンセンターオンライン（2026-08-21・実物のタイルを写した合成HTML） ──
  {
    name: "ポケセン: 商品タイルから pid/商品名/価格/画像 を読む",
    fn: () => {
      const html =
        '<ul class="comltemlist product-grid"> <li class="product" data-pid="4573102722058"> <div class="pho"><a href="/4573102722058.html"><img src="https://www.pokemoncenter-online.com/a/img/item/4573102722058/M/x.jpg" alt="プラコロ" loading="lazy" /></a></div> <div class="txtBox"> <p class="txt"><a href="/4573102722058.html">プラコロ スタートセット イーブイ 05</a></p> <p class="price "> <a href="/4573102722058.html"> 990<small>円</small> </a> </p> </div> </li></ul>';
      const t = parsePokecenTiles(html)[0];
      return `${t?.pid}|${t?.title}|${t?.priceYen}|${t?.imageUrl?.includes("4573102722058")}`;
    },
    want: "4573102722058|プラコロ スタートセット イーブイ 05|990|true",
  },
  { name: "ポケセン: タイルの無いHTMLは0件（→scraperがthrowして赤くする）", fn: () => parsePokecenTiles("<html><body>nav</body></html>").length, want: 0 },
  { name: "ポケセン: ポケカ商品はトレカへ", fn: () => pokecenGenre("ポケモンカードゲーム MEGA 拡張パック").genre, want: "トレカ" },
  { name: "ポケセン: グッズはポケモンへ", fn: () => pokecenGenre("プラコロ スタートセット イーブイ 05").genre, want: "ポケモン" },


  // ── 商品ページの <title>（検索クエリの形になっているか） ────────────
  // 2026-08-18まで `${商品名} | ハツコレ` だけで、「〇〇 発売日」「〇〇 抽選」という
  // 実際に打たれる形の語が2846ページのどこにも無かった。足すのは裏取り済みの事実だけ。
  {
    name: "title: 商品名だけでなく『の発売日』と日付が入る",
    fn: () => itemPageTitle({ name: "ワンピースカード 新弾", heading: "発売日", date: "9/5(金)", hasLottery: false }),
    want: "ワンピースカード 新弾の発売日｜9/5(金) | ハツコレ",
  },
  {
    name: "title: 抽選ありの行だけ『抽選あり』を足す",
    fn: () => itemPageTitle({ name: "限定タオル", heading: "発売日", date: "9/5(金)", hasLottery: true }),
    want: "限定タオルの発売日｜9/5(金)・抽選あり | ハツコレ",
  },
  {
    // 見出しが既に「抽選日」なら「抽選あり」は同じことの二度書き。
    name: "title: 見出しが抽選日なら『抽選あり』を重ねない",
    fn: () => itemPageTitle({ name: "限定タオル", heading: "抽選日", date: "9/5(金)", hasLottery: true }),
    want: "限定タオルの抽選日｜9/5(金) | ハツコレ",
  },
  {
    name: "title: 抽選が裏取りできていないなら書かない",
    fn: () => itemPageTitle({ name: "限定タオル", heading: "発売日", date: "9/5(金)", hasLottery: false }),
    want: "限定タオルの発売日｜9/5(金) | ハツコレ",
  },
  {
    name: "title: 日付が無いなら日付を書かない",
    fn: () => itemPageTitle({ name: "新作フィギュア", heading: "登場予定", date: null, hasLottery: false }),
    want: "新作フィギュアの登場予定 | ハツコレ",
  },
  {
    name: "title: 名前に既にある語は重ねない",
    fn: () => itemPageTitle({ name: "〇〇の発売日まとめ", heading: "発売日", date: "9/5(金)", hasLottery: false }),
    want: "〇〇の発売日まとめ｜9/5(金) | ハツコレ",
  },
  {
    name: "title: 名前に「抽選」があれば『抽選あり』を重ねない",
    fn: () => itemPageTitle({ name: "限定タオル抽選販売", heading: "発売日", date: null, hasLottery: true }),
    want: "限定タオル抽選販売の発売日 | ハツコレ",
  },
  {
    // eventType="情報" だと eventDateHeading が「情報日」を作る（実測5件）。
    // 画面の見出しなら文脈で読めるが、検索結果のタイトルは単体で読まれる。
    name: "title: 日本語にならない見出し語は落として名前だけにする",
    fn: () => itemPageTitle({ name: "新作フィギュア", heading: "情報日", date: "9/5(金)", hasLottery: false }),
    want: "新作フィギュア｜9/5(金) | ハツコレ",
  },
  {
    // 名前を40字で切ると同一タイトルが128件生まれた（実測）。切らないと0件。
    name: "title: 長い名前を切り詰めない（ページ同士が同じ顔にならない）",
    fn: () =>
      itemPageTitle({
        name: "ワンピース KING OF ARTIST THE MONKEY.D.LUFFY GEAR5 SPECIAL COLOR ver.A",
        heading: "発売日",
        date: "9/5(金)",
        hasLottery: false,
      }).includes("SPECIAL COLOR ver.A"),
    want: true,
  },

  // ガシャポン: 量産の300〜500円を載せない（載せる基準そのもの）
  {
    name: "ガシャポン: 300円の量産ガシャは載せない",
    fn: () => isResaleWorthyGashapon({ name: "サンリオ めじるしアクセサリー", category: "ガシャポン", yen: 300 } as GashaponCard),
    want: false,
  },
  {
    name: "ガシャポン: プレミアムは載せる",
    fn: () => isResaleWorthyGashapon({ name: "いきもの大図鑑 セミ02", category: "プレミアム", yen: 1500 } as GashaponCard),
    want: true,
  },
  {
    name: "ガシャポン: ショップ限定は安くても載せる",
    fn: () => isResaleWorthyGashapon({ name: "【ガシャポンバンダイオフィシャルショップ限定】HG ONE PIECE 01", category: "ガシャポン", yen: 500 } as GashaponCard),
    want: true,
  },

  // ミタスニーカーズ抽選: 締切が読めない記事は載せない（間に合うか判断できないため）
  {
    name: "mita: 抽選応募期間の締切日を読む",
    fn: () =>
      parseMitaDrawDetail(
        `<div class="entry-content">NIKE MIND 001 ￥13,200(税込) 抽選応募期間 2026年8月15日(土)0:00am～2026年8月18日(火)19:00pm</div>`
      ).deadline?.toISOString().slice(0, 10),
    want: "2026-08-18",
  },
  {
    name: "mita: 応募期間が無ければ締切なし（載せない側に倒す）",
    fn: () => parseMitaDrawDetail(`<div class="entry-content">NIKE MIND 001 ￥13,200(税込)</div>`).deadline,
    want: null,
  },
  {
    name: "mita: 来店抽選は店頭と見分ける",
    fn: () =>
      parseMitaDrawDetail(
        `<div class="entry-content">来店抽選受付 抽選応募期間 2026年8月15日(土)0:00am～2026年8月18日(火)19:00pm</div>`
      ).inStore,
    want: true,
  },

  // ── 画像の後付け: 検索語から「店の売り方」を落とす（2026-08-18） ─────────────
  // 括弧の中の語だけを消していたので壊れた断片が残り、楽天に投げても当たらなかった。
  {
    name: "画像検索語: 末尾の「（再販・おひとり様1BOXまで）」を括弧ごと落とす",
    fn: () => imgSearchQueryName("ポケモンカードゲーム MEGA 拡張パック「メガブレイブ」（再販・おひとり様1BOXまで）"),
    want: "ポケモンカードゲーム MEGA 拡張パック「メガブレイブ」",
  },
  {
    name: "画像検索語: 「1BOX（5,760円税込・現金払いのみ）」も落とす",
    fn: () => imgSearchQueryName("ONE PIECEカードゲーム ブースターパック 世界最強の戦士【OP-17】 1BOX（5,760円税込・現金払いのみ）"),
    want: "ONE PIECEカードゲーム ブースターパック 世界最強の戦士【OP-17】",
  },
  {
    // 収集元（店のX投稿）でタイトルが切れ、閉じ括弧が無いまま入っていることがある。
    name: "画像検索語: 閉じ括弧が無い「（事前抽選による」も落とす",
    fn: () => imgSearchQueryName("ONE PIECEカードゲーム ブースターパック 世界最強の戦士【OP-17】（事前抽選による"),
    want: "ONE PIECEカードゲーム ブースターパック 世界最強の戦士【OP-17】",
  },
  {
    // **商品名の一部である括弧は触らない**（触ると別商品を指す名前になる）。
    name: "画像検索語: 商品名の括弧（ハチワレ）は残す",
    fn: () => imgSearchQueryName("ちいかわ ひっかけぬいぐるみ（ハチワレ）"),
    want: "ちいかわ ひっかけぬいぐるみ（ハチワレ）",
  },
  {
    name: "画像検索語: 「限定」は商品名側にも出るので括弧を落とす理由にしない",
    fn: () => imgSearchQueryName("ねんどろいど ホロライブ（限定カラー）"),
    want: "ねんどろいど ホロライブ（限定カラー）",
  },

  // 同じ画像に解決した行を「行ごと」に分ける根拠＝型番（2026-08-18）。
  // 名前の長さでは特定性を測れない（「ONE PIECE カードゲーム」は長いが作品名でしかない）。
  {
    name: "型番: 【OP-17】を型番として拾う",
    fn: () => identityCodes("ONE PIECEカードゲーム ブースターパック 世界最強の戦士【OP-17】").join(","),
    want: "op17",
  },
  {
    name: "型番: 短い名前でも型番があれば同じ商品と分かる",
    fn: () => identityCodes("世界最強の戦士【OP-17】").join(","),
    want: "op17",
  },
  {
    // これが混ざっていたせいで、正しい8行の写真まで道連れで捨てていた。
    name: "型番: 作品名だけの名前には型番が無い",
    fn: () => identityCodes("ONE PIECE カードゲーム").length,
    want: 0,
  },

  // 付ける側と検査側で共有する唯一の定義（両方に式を書いて片方だけ直した事故の再発防止）。
  {
    // 店の売り方が違うだけの同一商品＋短い別ソース名。全員に画像を渡してよい。
    name: "同一商品: 型番が揃っていれば売り方の違いは無視して全員採用",
    fn: () =>
      keepableSameProduct([
        "ONE PIECEカードゲーム ブースターパック 世界最強の戦士【OP-17】（お1人様1BOX）",
        "ONE PIECEカードゲーム ブースターパック 世界最強の戦士【OP-17】 1BOX（5,760円税込・現金払いのみ）",
        "世界最強の戦士【OP-17】",
      ]).join(","),
    want: "true,true,true",
  },
  {
    // **作品名しか無い行だけ**を落とす（12月のプレバン限定品が OP-17 の箱写真を借りていた）。
    name: "同一商品: 作品名だけの行は型番が無いので落とす",
    fn: () =>
      keepableSameProduct([
        "ONE PIECEカードゲーム ブースターパック 世界最強の戦士【OP-17】（お1人様1BOX）",
        "世界最強の戦士【OP-17】",
        "ONE PIECE カードゲーム",
      ]).join(","),
    want: "true,true,false",
  },
  {
    name: "同一商品: 型番が無い商品名は全ペア一致を要求（緩めない）",
    fn: () =>
      keepableSameProduct([
        "ポケモンカードゲーム MEGA 拡張パック「ストームエメラルダ」（再販・おひとり様1BOXまで）",
        "ポケモンカードゲーム MEGA 拡張パック「ストームエメラルダ」（8月下旬再販分）",
      ]).join(","),
    want: "true,true",
  },
  {
    name: "同一商品: 別商品どうしが同じ画像なら全員不採用（バナー）",
    fn: () => keepableSameProduct(["ちいかわ マスコット", "ガンダム デカール"]).join(","),
    want: "false,false",
  },

  // ── 巡回の窓（2026-08-18・同じ日に3ソースで取りこぼしが出た型） ─────────────
  // 判定はこの純関数1つに集約してある（crawlPages はこれに従うだけ）。
  {
    name: "巡回: 新規が出続けていれば次のページへ",
    fn: () => crawlDecision({ page: 3, added: 12, reachedOld: false, maxPages: 40 }),
    want: "continue",
  },
  {
    name: "巡回: 新規が0になったら終端",
    fn: () => crawlDecision({ page: 3, added: 0, reachedOld: false, maxPages: 40 }),
    want: "stop",
  },
  {
    name: "巡回: 足切りより古くなったら終端",
    fn: () => crawlDecision({ page: 3, added: 12, reachedOld: true, maxPages: 40 }),
    want: "stop",
  },
  {
    // ここが本体。**上限に当たったのにまだ新規が出続けている＝窓が追い越された。**
    // 黙って半分だけ取り込むと「正常な巡回」に見える（nyuka_now が実際に53%落としていた）。
    name: "巡回: 上限に当たってもまだ新規がある → 例外（取りこぼしを成功にしない）",
    fn: () => crawlDecision({ page: 40, added: 12, reachedOld: false, maxPages: 40 }),
    want: "overrun",
  },
  {
    // 上限に当たっていても、それが**正常な終端**なら赤くしない（暦が進むだけで鳴る検査にしない）。
    name: "巡回: 上限ちょうどで足切りに達したのは正常な終了",
    fn: () => crawlDecision({ page: 40, added: 12, reachedOld: true, maxPages: 40 }),
    want: "stop",
  },
  {
    name: "巡回: ページ末尾が足切りより古い → 古い",
    fn: () =>
      lastIsOlderThan((d: Date | null) => d, Date.UTC(2026, 7, 8))([
        new Date(Date.UTC(2026, 7, 10)),
        new Date(Date.UTC(2026, 7, 1)),
      ]),
    want: true,
  },
  {
    // 日付が読めない要素で巡回を止めない（書式が変わった日にソースが丸ごと縮む）。
    name: "巡回: ページ末尾の日付が読めないなら止めない",
    fn: () =>
      lastIsOlderThan((d: Date | null) => d, Date.UTC(2026, 7, 8))([
        new Date(Date.UTC(2026, 7, 10)),
        null,
      ]),
    want: false,
  },
  {
    name: "ページ送りlint: 自前のページ送りループを見つける",
    fn: () =>
      gl("for (let p = 1; p <= MAX_PAGES; p++) { const html = await fetchHtml(url(p)); }").length,
    want: 1,
  },
  {
    name: "ページ送りlint: crawlPages 経由なら鳴らない",
    fn: () => gl('await crawlPages({ urlOf: (p) => url(p), maxPages: 40 });').length,
    want: 0,
  },
  {
    // 詳細ページを1件ずつ取りに行くループは「ページ送り」ではない＝対象外。
    name: "ページ送りlint: 記事を1件ずつ取るループは対象外",
    fn: () => gl("for (const it of items) { const html = await fetchHtml(it.url); }").length,
    want: 0,
  },
  {
    name: "ページ送りlint: crawl.ts 自身は検査対象外",
    fn: () => isCrawlLinted("src/scrapers/crawl.ts"),
    want: false,
  },

  // ── 販売単位だけが違う2枚（2026-08-18 実測10組・トレカ速報8組ほか） ──
  {
    name: "単位: BOX違いは1枚に畳む（単位表記の無い方を残す）",
    fn: () => {
      const rows = dedupeItems([
        { id: 1, source: "torecasoku", title: "【ヴァイスシュヴァルツ】ブースターパック 葬送のフリーレン Vol.2", url: "https://a/1", price: "440円", eventDate: new Date(Date.UTC(2026, 7, 28)), eventType: "発売" },
        { id: 2, source: "torecasoku", title: "【ヴァイスシュヴァルツ】ブースターパック 葬送のフリーレン Vol.2 【10パック入りBOX】", url: "https://a/2", price: "4,400円", eventDate: new Date(Date.UTC(2026, 7, 28)), eventType: "発売" },
      ] as never[]);
      return (rows as { id: number }[]).map((r) => r.id).join(",");
    },
    want: "1",
  },
  {
    name: "単位: 発売日が違えば別イベントとして残す",
    fn: () => {
      const rows = dedupeItems([
        { id: 1, source: "torecasoku", title: "【ヴァイスシュヴァルツ】ブースターパック 葬送のフリーレン Vol.2", url: "https://a/1", eventDate: new Date(Date.UTC(2026, 7, 28)), eventType: "発売" },
        { id: 2, source: "torecasoku", title: "【ヴァイスシュヴァルツ】ブースターパック 葬送のフリーレン Vol.2 【10パック入りBOX】", url: "https://a/2", eventDate: new Date(Date.UTC(2026, 8, 28)), eventType: "発売" },
      ] as never[]);
      return (rows as { id: number }[]).length;
    },
    want: 2,
  },
  {
    // 実測: `…アクリルスタンド(BOX=8)` は eventDate も eventDateText も無く、相方（8/31発売）と
    // 束ねられずに一覧へ2枚並んでいた。日付が1つしか無い組なら日付なしも同じ回とみなす。
    name: "単位: 日付なしのBOX行も、同じ回が1つだけなら束ねる",
    fn: () => {
      const rows = dedupeItems([
        { id: 1, source: "torecasoku", title: "遊☆戯☆王GX トゥーン・ワールド アクリルスタンド", url: "https://a/1", eventDate: new Date(Date.UTC(2026, 7, 31)), eventType: "発売" },
        { id: 2, source: "torecasoku", title: "遊☆戯☆王GXトゥーン・ワールド アクリルスタンド(BOX=8)", url: "https://a/2", eventDate: null, eventType: "発売" },
      ] as never[]);
      return (rows as { id: number }[]).map((r) => r.id).join(",");
    },
    want: "1",
  },
  {
    // 同じ名前で日付が2つ以上ある＝再販などで別の回がある。日付なしがどの回か分からないので束ねない。
    name: "単位: 回が2つある組では日付なしを束ねない",
    fn: () =>
      groupSaleUnits(
        [
          { id: 1, source: "s", title: "ブースターパック X", price: null, url: null, eventDate: new Date(Date.UTC(2026, 7, 31)) },
          { id: 2, source: "s", title: "ブースターパック X", price: null, url: null, eventDate: new Date(Date.UTC(2026, 9, 31)) },
          { id: 3, source: "s", title: "ブースターパック X 【10パック入りBOX】", price: null, url: null, eventDate: null },
        ],
        (r) => r.title
      ).length,
    want: 0,
  },
  // 単位表記が**どちらにも無い**組は「単位違い」ではない（同名の別記事＝別の重複の型）。
  { name: "単位: 表記なし同士は単位違いとして畳まない", fn: () => isSaleUnitGroup([{ title: "ONE PIECE カードゲーム" }, { title: "ONE PIECE カードゲーム" }]), want: false },
  { name: "単位: 版の名前（箱ver.）は単位と読まない", fn: () => saleUnitLabel("【箱ver.】サンリオキャラクターズ おおきなSOFVIMATES～マイメロディ～"), want: null },
  { name: "単位: 前置きの【BOX販売】も単位", fn: () => saleUnitLabel("【BOX販売】HB-BP01 ホロビートカードゲーム 拡張パック第一弾"), want: "BOX販売" },
  { name: "単位: (BOX=8) も単位", fn: () => saleUnitLabel("遊☆戯☆王GX トゥーン・ワールド アクリルスタンド(BOX=8)"), want: "BOX=8" },
  // ラベルは収集元の表記のまま。**「単品」と言い換えない**（実測: 表記なしの行が1BOXで、
  // 相方が1カートンの組があった＝どちらが小さい単位かは数えられない）。
  {
    name: "単位: 一覧は安い順・表記なしの行は商品名をラベルにする",
    fn: () =>
      buildSaleUnits(
        [
          { id: 2, source: "torecasoku", title: "ブースターパック X 【10パック入りBOX】", price: "4,400円", url: null, eventDate: null },
          { id: 1, source: "torecasoku", title: "ブースターパック X", price: "440円", url: null, eventDate: null },
        ],
        (r) => r.title
      )
        .map((u) => `${u.label}=${u.price}`)
        .join(" / "),
    want: "ブースターパック X=440円 / 10パック入りBOX=4,400円",
  },

  // ── 同じ応募ページ・同じ応募先で、名前の書き方だけ違う2枚（2026-08-18 実測 #75445/#75446） ──
  {
    name: "重複: 同じurl・同じstores・同じ日で名前が包含関係 → 具体的な方を残す",
    fn: () => {
      const rows = dedupeItems([
        { id: 1, source: "nike_snkrs", title: "ナイキ エア フォース 1 LOW プロトロ", url: "https://x/y", eventDate: new Date(Date.UTC(2026, 7, 20)), eventType: "抽選" },
        { id: 2, source: "nike_snkrs", title: "ナイキ エア フォース 1 LOW プロトロ LOTR", url: "https://x/y", eventDate: new Date(Date.UTC(2026, 7, 20)), eventType: "抽選" },
      ] as never[]);
      return (rows as { id: number }[]).map((r) => r.id).join(",");
    },
    want: "2",
  },
  {
    // **1つの応募ページで複数商品を同時抽選する店は実在する**（実測13組中ほとんどがこれ）。
    // 名前が包含関係にない＝別商品なので畳んではいけない。
    name: "重複: 同じurlでも別商品（包含関係なし）は両方残す",
    fn: () => {
      const rows = dedupeItems([
        { id: 1, source: "card_chusen", title: "ポケモンカードゲーム MEGA 拡張パック メガブレイブ", url: "https://shop/lottery", eventDate: new Date(Date.UTC(2026, 7, 21)), eventType: "抽選" },
        { id: 2, source: "card_chusen", title: "ポケモンカードゲーム MEGA 拡張パック メガシンフォニア", url: "https://shop/lottery", eventDate: new Date(Date.UTC(2026, 7, 21)), eventType: "抽選" },
      ] as never[]);
      return (rows as { id: number }[]).length;
    },
    want: 2,
  },
  {
    // 応募先が違えば別の応募＝畳むと情報が消える。
    name: "重複: stores が違えば畳まない",
    fn: () => {
      const A = JSON.stringify([{ name: "Aストア", url: "https://a", form: null, when: null, note: null, at: "2026-08-20", kind: "締切" }]);
      const B = JSON.stringify([{ name: "Bストア", url: "https://b", form: null, when: null, note: null, at: "2026-08-20", kind: "締切" }]);
      const rows = dedupeItems([
        { id: 1, source: "nyuka_now", title: "ポケモンカード メガブレイブ", url: "https://x/y", stores: A, eventDate: new Date(Date.UTC(2026, 7, 20)), eventType: "抽選" },
        { id: 2, source: "nyuka_now", title: "ポケモンカード メガブレイブ BOX", url: "https://x/y", stores: B, eventDate: new Date(Date.UTC(2026, 7, 20)), eventType: "抽選" },
      ] as never[]);
      return (rows as { id: number }[]).length;
    },
    want: 2,
  },

  // ── 月ページの所属は「応募期間が月と重なるか」（2026-08-18 実測3件/628件） ─────
  {
    name: "月ページ: 応募期間が8/22〜9/2 の行は9月と重なる",
    fn: () => {
      const stores = JSON.stringify([
        { name: "A", url: null, form: null, when: null, note: null, at: "2026-08-22", kind: "締切" },
        { name: "B", url: null, form: null, when: null, note: null, at: "2026-09-02", kind: "締切" },
      ]);
      return overlapsRange(
        { eventDate: new Date(Date.UTC(2026, 8, 2)), stores },
        new Date(Date.UTC(2026, 8, 1)),
        new Date(Date.UTC(2026, 9, 1))
      );
    },
    want: true,
  },
  {
    // **8月にも出る**のが要点。表示日だけで動かすと「8月にも9月にも出ない」穴が空く。
    name: "月ページ: 同じ行は8月とも重なる（どちらの月からも見つかる）",
    fn: () => {
      const stores = JSON.stringify([
        { name: "A", url: null, form: null, when: null, note: null, at: "2026-08-22", kind: "締切" },
        { name: "B", url: null, form: null, when: null, note: null, at: "2026-09-02", kind: "締切" },
      ]);
      return overlapsRange(
        { eventDate: new Date(Date.UTC(2026, 8, 2)), stores },
        new Date(Date.UTC(2026, 7, 1)),
        new Date(Date.UTC(2026, 8, 1))
      );
    },
    want: true,
  },
  {
    name: "月ページ: 期間がかからない月には出さない",
    fn: () =>
      overlapsRange(
        { eventDate: new Date(Date.UTC(2026, 8, 2)), stores: null },
        new Date(Date.UTC(2026, 6, 1)),
        new Date(Date.UTC(2026, 7, 1))
      ),
    want: false,
  },
  {
    // 応募先を何ヶ月分も溜め込んだハブ記事を、そのまま9ヶ月分の月ページに並べない。
    name: "月ページ: 期間の幅は締切から62日までに丸める",
    fn: () => {
      const stores = JSON.stringify([
        { name: "古", url: null, form: null, when: null, note: null, at: "2026-01-10", kind: "締切" },
        { name: "新", url: null, form: null, when: null, note: null, at: "2026-08-20", kind: "締切" },
      ]);
      const p = itemPeriodMs({ eventDate: new Date(Date.UTC(2026, 7, 20)), stores })!;
      return Math.round((p.end - p.start) / 86_400_000);
    },
    want: 62,
  },
  // ── 応募先の店の告知バナーを商品写真にしない（2026-08-18 本人指摘・/items/75417） ──
  {
    name: "画像: 応募先ブログと同じホストの画像は告知バナーとみなす",
    fn: () =>
      isStoreNoticeImage("https://www.c-labo.jp/wordpress/wp-content/uploads/2026/08/psjuMo39.png", [
        { url: "https://www.c-labo.jp/shop/kyoto/blog/612915/" },
      ]),
    want: true,
  },
  {
    // 応募先が**個別商品ページ**なら、そこの画像は本物の商品写真＝触らない。
    name: "画像: 応募先が個別商品ページ（プレバン）なら触らない",
    fn: () =>
      isStoreNoticeImage("https://p-bandai.jp/images/item/1000255803.jpg", [
        { url: "https://p-bandai.jp/item/item-1000255803/" },
      ]),
    want: false,
  },
  {
    name: "画像: 応募先と無関係なホスト（楽天の商品写真）は触らない",
    fn: () =>
      isStoreNoticeImage("https://thumbnail.image.rakuten.co.jp/@0_mall/dra-shop/cabinet/x.jpg", [
        { url: "https://www.c-labo.jp/shop/kyoto/blog/612915/" },
      ]),
    want: false,
  },
  {
    name: "画像: 応募先が無い行は対象外",
    fn: () => isStoreNoticeImage("https://example.com/a.jpg", null),
    want: false,
  },
  // ── ページ内で一意のJANでも、その商品のJANとは限らない（2026-08-18・#92497） ──
  {
    // 実測した事故そのもの。同じコードの画像が、別の店のサムネイルとして2つの商品に付いた。
    // URLは一致しないので image_shared では出ない＝URLの中のコードで束ねて初めて見える。
    name: "画像: 同じ商品コードの写真が別商品に付いていたら指摘する",
    fn: () =>
      conflictingJanImages(
        [
          {
            n: "ポケモンカードゲーム スタートデッキ100",
            u: "https://thumbnail.image.rakuten.co.jp/@0_mall/yum-yum/cabinet/4521329427270.jpg",
          },
          {
            n: "ポケモンカード 30th CELEBRATION 御三家カードセット(フシギダネ・ヒトカゲ・ゼニガメ)",
            u: "https://thumbnail.image.rakuten.co.jp/@0_mall/auc-ookawaya/cabinet/10001/03/4521329427270.jpg",
          },
        ],
        (r) => r.u,
        (r) => r.n
      ).length,
    want: 1,
  },
  {
    // 同じ商品の別ロット（再販・追加入荷）は同じ写真が付くのが正解＝指摘しない。
    name: "画像: 同じ商品の別ロットに同じコードの写真が付くのは正常",
    fn: () =>
      conflictingJanImages(
        [
          { n: "ポケモンカードゲーム 拡張パック メガシンフォニア", u: "https://x/4521329431185.jpg" },
          { n: "ポケモンカードゲーム 拡張パック メガシンフォニア（再販分）", u: "https://y/4521329431185.jpg" },
        ],
        (r) => r.u,
        (r) => r.n
      ).length,
    want: 0,
  },
  {
    // 収集元ごとの表記ゆれ（超 ↔ スーパー）で別商品扱いにしない。実測 2026-08-18 に
    // この2行は同じ商品・同じ写真で、指摘する側だけが名前で不一致になっていた。
    name: "画像: 表記ゆれ（超↔スーパー）だけの2行は別商品としない",
    fn: () =>
      conflictingJanImages(
        [
          { n: "ドラゴンボール超カードゲーム フュージョンワールド STORY BOOSTER 01", u: "https://x/4582770011982.jpg" },
          {
            n: "ドラゴンボール スーパーカードゲーム フュージョンワールド STORY BOOSTER 01[ST01]",
            u: "https://y/4582770011982.jpg",
          },
        ],
        (r) => r.u,
        (r) => r.n
      ).length,
    want: 0,
  },
  // ── 作品名＋種別しか無い名前で画像を借りない（2026-08-18・#91599） ──
  {
    // 実測した事故。まとめ記事の見出しがそのまま商品名になっている行に、OP-17 の箱写真が付いた。
    name: "画像: 作品名と種別しか無い名前では画像を借りない",
    fn: () => isTooGenericForImageSearch("ONE PIECE カードゲーム"),
    want: true,
  },
  {
    name: "画像: 「◯◯各種」も商品を決められない",
    fn: () => isTooGenericForImageSearch("人気ポケモンカード各種"),
    want: true,
  },
  {
    name: "画像: 弾名が入っていれば借りてよい",
    fn: () => isTooGenericForImageSearch("ポケモンカードゲーム スタートデッキ100"),
    want: false,
  },
  {
    // 一般語だけの query は具体的な商品名すべてに一致してしまう＝長さの足切りでは防げない。
    // だから**借りる側の入口**（pickListedImage）で止める。
    name: "画像: 一般語だけの名前では検索結果から借りない",
    fn: () =>
      pickListedImage(
        `<script type="application/ld+json">${JSON.stringify({
          "@type": "ItemList",
          itemListElement: [
            {
              item: {
                name: "ONE PIECE カードゲーム ブースターパック 世界最強の戦士 OP-17 BOX",
                image: ["https://thumbnail.image.rakuten.co.jp/@0_mall/x/cabinet/a.jpg"],
                url: "https://item.rakuten.co.jp/x/a/",
              },
            },
          ],
        })}</script>`,
        "ONE PIECE カードゲーム"
      ) === null,
    want: true,
  },
  {
    // 逆側の固定: 同じ検索結果でも、弾名がある名前なら借りられる（止めすぎていないことの確認）。
    name: "画像: 弾名がある名前なら検索結果から借りられる",
    fn: () =>
      pickListedImage(
        `<script type="application/ld+json">${JSON.stringify({
          "@type": "ItemList",
          itemListElement: [
            {
              item: {
                name: "ONE PIECE カードゲーム ブースターパック 世界最強の戦士 OP-17 BOX",
                image: ["https://thumbnail.image.rakuten.co.jp/@0_mall/x/cabinet/a.jpg"],
                url: "https://item.rakuten.co.jp/x/a/",
              },
            },
          ],
        })}</script>`,
        "ONE PIECEカードゲーム ブースターパック 世界最強の戦士【OP-17】"
      )?.via,
    want: "listed",
  },
  {
    // 「同じ商品か」の判定（keepableSameProduct）は作品名だけの行も相手にできる必要がある＝
    // 借りる側の門を productNameMatches に入れてはいけない、という規約の固定。
    name: "画像: 一般語だけの名前でも同一商品の判定には使える",
    fn: () => productNameMatches("ONE PIECE カードゲーム", "ONE PIECE カードゲーム ブースターパック 世界最強の戦士 OP-17 BOX"),
    want: true,
  },
  {
    name: "画像: URLにコードが無い画像は対象外",
    fn: () =>
      conflictingJanImages(
        [
          { n: "商品A", u: "https://x/photo.jpg" },
          { n: "まったく別の商品B", u: "https://y/photo2.jpg" },
        ],
        (r) => r.u,
        (r) => r.n
      ).length,
    want: 0,
  },
  // ── 検索: ブランドのカタカナ↔英字（2026-08-18・watchlist が見つけた「載せているのに0件」） ──
  {
    // 収集元は英字で載せるが、日本語話者はカタカナで検索する。実測でここが0件だった。
    name: "検索: カタカナ「ニューバランス」で英字タイトルに当たる",
    fn: () => matchesQuery("New Balance 990v6 Made in USA", "ニューバランス"),
    want: true,
  },
  {
    name: "検索: 英字「asics」でカタカナタイトルにも当たる",
    fn: () => matchesQuery("アシックス ゲルカヤノ 14", "asics"),
    want: true,
  },
  {
    name: "検索: 別ブランドには当たらない（同義語で当たりすぎない）",
    fn: () => matchesQuery("NIKE AIR MAX 95", "アディダス"),
    want: false,
  },
  {
    // 監視する層は「理由(why)」つきでしか足せない＝空の理由を混ぜたら気付けるようにする。
    name: "watchlist: 全ての語に理由が書いてある",
    fn: () => WATCHLIST.every((w) => w.why.trim().length >= 8),
    want: true,
  },
  {
    name: "watchlist: 掲載件数はサイトの検索と同じ物差しで数える",
    fn: () =>
      countWatchlist(["New Balance 990v6", "ポケモンカード 拡張パック"], (t, w) => matchesQuery(t, w)).find(
        (h) => h.word === "ニューバランス"
      )?.hits,
    want: 1,
  },

  // ── ポケモン公式グッズの日付（裏の取れない「登場日」を約束しない） ──
  // 実測 2026-08-19（観点A・無作為10件）: API の start_date は記事の掲載日で、
  // 10件すべてが同じ日。一次情報と読み比べられた2件はどちらも食い違っていた。
  { name: "ポケ公式: 掲載日は日付欄に出さない", fn: () => displayEventDateText("掲載日 2026/08/14"), want: null },
  { name: "ポケ公式: 「登場」と書けば出てしまう（だから書かない）", fn: () => displayEventDateText("登場 2026/08/14"), want: "登場 2026/08/14" },
  { name: "ポケ公式: 掲載日からでも新着期間は判定できる", fn: () => parseAppearedDate("掲載日 2026/08/14")?.toISOString().slice(0, 10), want: "2026-08-14" },
  {
    name: "ポケ公式: 30日を過ぎた掲載は新着から外れる",
    fn: () => isRecentPokemonGoods("掲載日 2026/07/01", new Date(Date.UTC(2026, 7, 19))),
    want: false,
  },

  // ── 採用0件の見分け（静かな日 / 壊れた） ────────────────────
  // 実測 2026-08-19: mita_draw が採用0件でも 🟢 だった（前回1件＝しきい値5に届かないため）。
  // 収集元を開いたら本当に受付中が無い日で、0件が正しかった。壊れた場合も同じ 🟢 になるので、
  // 「一覧から記事が取れたか」で分ける。
  { name: "採用0件: 一覧も0件なら壊れている", fn: () => zeroAdoptionVerdict(0, 0)?.level, want: "error" },
  { name: "採用0件: 記事は取れているなら静かな日（鳴らさず観測に出す）", fn: () => zeroAdoptionVerdict(0, 20)?.level, want: "info" },
  { name: "採用0件: 巡回件数が分からないソースは判定しない", fn: () => zeroAdoptionVerdict(0, null), want: null },
  { name: "採用0件: 1件でも採用していれば対象外", fn: () => zeroAdoptionVerdict(3, 0), want: null },

  // ── 個別ページが無い行の置き場（figisland の一覧URL） ──────────
  {
    name: "置き場: 一覧URLは商品ページとして数えない",
    fn: () => figislandListPlaceholder("figisland", "https://figisland.net/prizes-schedule/"),
    want: true,
  },
  {
    name: "置き場: 個別ページを持つ行は対象外",
    fn: () => figislandListPlaceholder("figisland", "https://figisland.net/fi12345_s/"),
    want: false,
  },
  {
    name: "置き場: 他のソースには広げない",
    fn: () => figislandListPlaceholder("torecasoku", "https://figisland.net/prizes-schedule/"),
    want: false,
  },
  {
    // 置き場が成立する前提＝そのURLを画面に出さないこと。
    // figisland を「公式ページで見る」を出すソースに入れた瞬間、一覧に送客することになる。
    name: "置き場: 置き場を持つソースの url は画面に出さない",
    fn: () => isOfficialUrl("figisland"),
    want: false,
  },

  // ── リポジトリの衛生（検索が空振りしない） ──────────────────
  {
    name: "ソースが全文検索から外れる書き方になっていない（BOM・生の制御文字）",
    fn: () => unsearchableSourceFiles().join(" / "),
    want: "",
  },
  {
    // 改行コードの取り決めが無いと、Windowsの書き戻し1回で**ファイル全体が差分**になり、
    // 実際の変更が読めなくなる（実測 2026-08-18: audit.ts が LF→CRLF になり 3,933行の差分）。
    name: "改行コードの取り決め（.gitattributes）がある",
    fn: () => {
      if (!existsSync(".gitattributes")) return ".gitattributes が無い";
      const t = readFileSync(".gitattributes", "utf8");
      return /eol=lf/.test(t) ? "" : ".gitattributes に eol=lf が無い";
    },
    want: "",
  },

  // ── 整形が語の途中で切っていないか ────────────────────────
  {
    name: "整形: 「…締切ですが」を「…締切で」で切った残りは商品名にしない",
    fn: () =>
      cleanListTitle(
        "channeltono",
        "9月27日締切ですがキアサージ と雲仙 早くも完売！Gift アズールレーン ぬいぐるみシリーズ チャパエフがあみあみで予約開始まだあり！"
      ),
    want: "Gift アズールレーン ぬいぐるみシリーズ チャパエフ",
  },
  {
    name: "整形: 店ごとの締切告知（◯日まで）は商品名にしない",
    fn: () =>
      cleanListTitle(
        "channeltono",
        "あみあみとプレバンは8月4日まで！トレカプラザ55は11日まで！ONE PIECEカードゲーム ブースターパック 世界最強の戦士[OP-17] 24パック入りBOXが抽選受付開始"
      ),
    want: "ONE PIECEカードゲーム ブースターパック 世界最強の戦士[OP-17] 24パック入りBOX",
  },
  {
    // 収集元（トレカ速報）が英語商品名の末尾にカテゴリ語「玩具」を直結させる粗
    // （実測 2026-08-21・MTG Secret Lair 行14件。収集元の h1/title 自体がこの表記）。
    name: "整形: ASCII英数字に直結した末尾の「玩具」を剥がす",
    fn: () =>
      cleanListTitle(
        "torecasoku",
        "【MTG】Secret Lair A Marvelous Mathom Superdrop Secret Lair x [ELDERBERRY]: Smaug's Spoils玩具"
      ),
    want: "【MTG】Secret Lair A Marvelous Mathom Superdrop Secret Lair x [ELDERBERRY]: Smaug's Spoils",
  },
  {
    name: "整形: 日本語の商品名が「玩具」で終わる形は触らない",
    fn: () => cleanListTitle("torecasoku", "昭和レトロ玩具"),
    want: "昭和レトロ玩具",
  },
  {
    name: "整形: ひらがなで始まる商品名は巻き込まない（前がひらがなでない）",
    fn: () => cutsMidWord("【予約開始】ちいかわ ぬいぐるみ", "ちいかわ ぬいぐるみ"),
    want: false,
  },
  {
    name: "整形: 助動詞の途中で切ったら鳴る",
    fn: () => cutsMidWord("9月27日締切ですがキアサージ と雲仙", "すがキアサージ と雲仙"),
    want: true,
  },
  {
    name: "整形: カタカナで始まるなら境目として正しい",
    fn: () => cutsMidWord("楽天ファッションでドラゴンクエスト コラボ", "ドラゴンクエスト コラボ"),
    want: false,
  },
  {
    name: "整形: 「いつまでも」を締切告知と読まない",
    fn: () => cleanListTitle("channeltono", "一番くじ 僕のヒーローアカデミア -いつまでも手を差し伸べ続ける物語-"),
    want: "一番くじ 僕のヒーローアカデミア -いつまでも手を差し伸べ続ける物語-",
  },

  // ── 死んだ画像（空白タイルにしない） ──────────────────────
  // 「消してよい失敗」と「消してはいけない失敗」の境目を合成データで固定する。
  // 消したら二度と戻らないので、ここを緩めると一時障害の日に画像が大量に消える。
  { name: "画像: 404 は消してよい", fn: () => imageVerdict({ status: 404, contentType: null, bytes: null }), want: "dead" },
  { name: "画像: 403（ホットリンク拒否）も、このサーバからは永久に取れないので消す", fn: () => imageVerdict({ status: 403, contentType: "text/html", bytes: null }), want: "dead" },
  { name: "画像: 200でもHTMLが返るなら画像は既に無い", fn: () => imageVerdict({ status: 200, contentType: "text/html; charset=utf-8", bytes: 1200 }), want: "dead" },
  { name: "画像: 200で0バイトは消す", fn: () => imageVerdict({ status: 200, contentType: "image/jpeg", bytes: 0 }), want: "dead" },
  { name: "画像: 500 は相手の一時障害なので消さない", fn: () => imageVerdict({ status: 500, contentType: null, bytes: null }), want: "unknown" },
  { name: "画像: 接続できない（時間切れ等）も消さない", fn: () => imageVerdict({ status: null, contentType: null, bytes: null }), want: "unknown" },
  { name: "画像: 正常な画像はそのまま", fn: () => imageVerdict({ status: 200, contentType: "image/webp", bytes: 40_000 }), want: "ok" },
  {
    // 画像プロキシと掃除が**同じ関数**を見ていること。片方だけ緩めると
    // 「空白は出るのにDBからは消えない」状態に戻る。
    name: "画像: プロキシも掃除と同じ判定関数を使っている",
    fn: () => {
      const route = readFileSync("src/app/(ja)/i/[id]/route.ts", "utf8");
      const prune = readFileSync("scripts/pruneDeadImages.ts", "utf8");
      return /imageVerdict\(/.test(route) && /imageVerdict\(/.test(prune);
    },
    want: true,
  },

  // ── 日付ロールオーバー（前日の「あと◯日」を配らない仕掛け） ──────────
  // 本物は本番の cron でしか動かないので、**入れた当日は一度も確かめられない**。
  // 鳴る側と鳴らない側を合成データで固定して、判定そのものを先に確かめる。
  {
    name: "ロールオーバー: 一度も動いていない → 警告だけ（デプロイ直後に必ず通る状態なのでERRORにしない）",
    fn: () => rolloverProblem(null, new Date("2026-08-19T00:00:00Z"))?.level,
    want: "warn",
  },
  {
    name: "ロールオーバー: 25時間前なら鳴らない（発火時刻のゆれで鳴らせない）",
    fn: () =>
      rolloverProblem(new Date("2026-08-18T00:00:00Z"), new Date("2026-08-19T01:00:00Z")),
    want: null,
  },
  {
    name: "ロールオーバー: 27時間止まったらERROR",
    fn: () =>
      rolloverProblem(new Date("2026-08-18T00:00:00Z"), new Date("2026-08-19T03:00:00Z"))?.level,
    want: "error",
  },
  { name: "cron: 15:01 UTC は日本時間 0時台", fn: () => cronJstHour("1 15 * * *"), want: 0 },
  { name: "cron: 0:01 UTC は日本時間 9時台（暦の変わり目ではない）", fn: () => cronJstHour("1 0 * * *"), want: 9 },
  { name: "cron: 毎日でない指定は対象外", fn: () => cronJstHour("1 15 * * 1"), want: null },
  {
    // 設定・実ファイル・定数の3つが揃って初めて動く。1つ欠けても画面は正常なままなので、
    // ここで突き合わせる（cronが存在しないのに「対策済み」と書いてある状態を作らない）。
    name: "ロールオーバー: vercel.json の cron が実在するルートを日本時間0時台に叩く",
    fn: () => {
      const conf = JSON.parse(readFileSync("vercel.json", "utf8")) as {
        crons?: { path: string; schedule: string }[];
      };
      const cron = conf.crons?.find((c) => c.path === ROLLOVER_CRON_PATH);
      if (!cron) return "vercel.json に cron が無い";
      if (cronJstHour(cron.schedule) !== 0) return `発火が日本時間0時台でない: ${cron.schedule}`;
      const route = `src/app${ROLLOVER_CRON_PATH}/route.ts`;
      if (!existsSync(route)) return `ルートの実ファイルが無い: ${route}`;
      if (!readFileSync(route, "utf8").includes("revalidatePath"))
        return "ルートがキャッシュを捨てていない（revalidatePath が無い）";
      return "";
    },
    want: "",
  },
  // ── 自分のアクセス除外（2026-08-19）────────────────────────────
  // 「入れた日に一度も確かめられない」型なのでここで固定する。
  // 本物で確かめるには自分のブラウザで踏むしかなく、踏んだ瞬間に結果（＝記録）が消える。
  {
    // 実測UA（2026-08-19）。このブラウザは navigator.webdriver が false なので、
    // webdriver だけを見る実装では**落ちない**。UAの印で落ちることを固定する。
    name: "除外: Claude Code の内蔵ブラウザ(Electron)は自動操作として落とす",
    fn: () => isAutomationUserAgent(CLAUDE_UA),
    want: true,
  },
  {
    name: "除外: 普通のAndroid Chromeは落とさない（本物の読者を消さない）",
    fn: () => isAutomationUserAgent(ANDROID_UA) || isCrawlerUserAgent(ANDROID_UA),
    want: false,
  },
  {
    name: "除外: 普通のWindows Chromeは落とさない",
    fn: () => isCountableUserAgent(WINDOWS_UA),
    want: true,
  },
  { name: "除外: 巡回UAは落とす", fn: () => isCountableUserAgent("Googlebot/2.1"), want: false },
  { name: "除外: localhost は本番ではない", fn: () => isProductionHostname("localhost"), want: false },
  {
    name: "除外: プレビュー配信(*.vercel.app)は本番ではない",
    fn: () => isProductionHostname("sedora-three.vercel.app"),
    want: false,
  },
  { name: "除外: 本番ドメインは本番", fn: () => isProductionHostname("hatsukore.com"), want: true },
  {
    name: "除外: app.localhost のようなサブドメインも開発機（完全一致だけ見ると素通りする）",
    fn: () => isProductionHostname("app.localhost"),
    want: false,
  },
  {
    // いちばん大事な「鳴らない側」。ここが壊れると誰も数えなくなる。
    name: "除外: 本番・普通のブラウザ・印なしの訪問は記録する",
    fn: () =>
      decideNolog({
        userAgent: ANDROID_UA,
        href: "https://hatsukore.com/items/516",
        hostname: "hatsukore.com",
        storedFlag: null,
      }).skip,
    want: false,
  },
  {
    name: "除外: ?nolog=1 を踏んだら落として印を残す",
    fn: () =>
      JSON.stringify(
        decideNolog({
          userAgent: WINDOWS_UA,
          href: "https://hatsukore.com/?nolog=1",
          hostname: "hatsukore.com",
          storedFlag: null,
        })
      ),
    want: JSON.stringify({ skip: true, store: "set", reason: "opt-out-now" }),
  },
  {
    name: "除外: 印が残っていれば以後の訪問は落ちる",
    fn: () =>
      decideNolog({
        userAgent: WINDOWS_UA,
        href: "https://hatsukore.com/",
        hostname: "hatsukore.com",
        storedFlag: "1",
      }).reason,
    want: "opted-out",
  },
  {
    name: "除外: ?nolog=0 で解除でき、その訪問は数える",
    fn: () =>
      JSON.stringify(
        decideNolog({
          userAgent: WINDOWS_UA,
          href: "https://hatsukore.com/?nolog=0",
          hostname: "hatsukore.com",
          storedFlag: "1",
        })
      ),
    want: JSON.stringify({ skip: false, store: "clear", reason: null }),
  },
  {
    // 解除の抜け道で自分の検証ブラウザを数え始めない（判定順の固定）。
    name: "除外: ?nolog=0 でも自動操作は数え始めない",
    fn: () =>
      decideNolog({
        userAgent: CLAUDE_UA,
        href: "https://hatsukore.com/?nolog=0",
        hostname: "hatsukore.com",
        storedFlag: null,
      }).reason,
    want: "automation",
  },
  { name: "除外: 値の無い ?nolog も除外と読む", fn: () => readNologParam("https://hatsukore.com/?nolog"), want: "on" },
  { name: "除外: 壊れたURLでも例外にしない", fn: () => readNologParam("not a url"), want: null },
  {
    // 3つ揃って初めて効く。1つ欠けても画面は正常なままなので突き合わせる。
    name: "除外: 設置口・イベント送信・受け口の3つが同じ判定を通っている",
    fn: () => {
      // ルートレイアウトは2つ（(ja) と /en）。どちらも同じ設置口を通っていること。
      for (const p of ["src/app/(ja)/layout.tsx", "src/app/en/layout.tsx"]) {
        const layout = readFileSync(p, "utf8");
        if (/<Analytics\s*\/>/.test(layout)) return `${p} が素の <Analytics /> を置いている（beforeSend が効かない）`;
        if (!layout.includes("SiteAnalytics")) return `${p} が除外つきの設置口を使っていない`;
      }
      const wrapper = readFileSync("src/components/SiteAnalytics.tsx", "utf8");
      if (!wrapper.includes("beforeSend")) return "設置口に beforeSend が無い";
      if (!readFileSync("src/lib/logEvent.ts", "utf8").includes("currentNologDecision"))
        return "logEvent が除外判定を通っていない";
      if (!readFileSync("src/app/api/track/route.ts", "utf8").includes("isCountableUserAgent"))
        return "/api/track が共通の UA 判定を使っていない";
      return "";
    },
    want: "",
  },

  // ── 英語版（/en）2026-08-20 ────────────────────────────────────────────
  // 日付書式・語彙・突合の英語面。JPと同じく「鳴る側」と「鳴らない側」を両方固定する。
  // 書式の約束: 月は綴る（"9/5" は米英で読みが割れる）・TZはJST明記（[[Projects/sedori_radar_en]]）。
  {
    name: "EN日付: 今年は年なし・来年は年つき（月は綴る）",
    fn: () => {
      const key = "HATSUKORE_SIMULATE_TODAY";
      const old = process.env[key];
      process.env[key] = "2026-08-20";
      try {
        return `${formatShortEn("2026-09-05T00:00:00.000Z")}|${formatShortEn("2027-01-05T00:00:00.000Z")}`;
      } finally {
        if (old === undefined) delete process.env[key];
        else process.env[key] = old;
      }
    },
    want: "Sep 5 (Sat)|Jan 5, 2027 (Tue)",
  },
  { name: "EN日付: 月精度は月までしか書かない", fn: () => formatMonthEn("2026-09-01T00:00:00.000Z"), want: "Sep 2026" },
  {
    name: "EN日付: 月精度の行に合成した特定日を出さない（eventDateLabelEn）",
    fn: () => eventDateLabelEn("2026-09-01T00:00:00.000Z", "2026年9月発送予定"),
    want: "Sep 2026",
  },
  {
    name: "EN日付: 投稿日は日付欄に出さない（JPと同じ規則）",
    fn: () => eventDateLabelEn(null, "投稿日: 2026-08-07"),
    want: null as string | null,
  },
  {
    name: "EN曜日突合: 暦と違う曜日で鳴る（2026-09-05は土曜）",
    fn: () => renderedDateProblems("Sep 5 (Fri)", calendarDate(2026, 8, 20)).length,
    want: 1,
  },
  {
    name: "EN曜日突合: 正しい曜日では鳴らない",
    fn: () => renderedDateProblems("Sep 5 (Sat)", calendarDate(2026, 8, 20)).length,
    want: 0,
  },
  {
    name: "EN曜日突合: 年つき書式も見る（2027-01-05は火曜）",
    fn: () =>
      renderedDateProblems("Jan 5, 2027 (Wed)", calendarDate(2026, 8, 20)).length +
      renderedDateProblems("Jan 5, 2027 (Tue)", calendarDate(2026, 8, 20)).length,
    want: 1,
  },
  {
    name: "ENラベル読取: 年なし・年つきとも読める（parseDisplayedDate）",
    fn: () =>
      `${parseDisplayedDate("Sep 5 (Sat)", calendarDate(2026, 8, 20))?.toISOString().slice(0, 10)}|${parseDisplayedDate("Sep 5, 2027 (Sun)", calendarDate(2026, 8, 20))?.toISOString().slice(0, 10)}`,
    want: "2026-09-05|2027-09-05",
  },
  {
    name: "ENラベル読取: 月精度 'Sep 2026' に日を足さない（nullを返す）",
    fn: () => parseDisplayedDate("Sep 2026", calendarDate(2026, 8, 20)),
    want: null as Date | null,
  },
  {
    name: "ENバッジ突合: 'Today' と当日ラベルは食い違いなし",
    fn: () => countdownBadgeProblem("🔥 Today", "Sep 5 (Sat)", calendarDate(2026, 9, 5)),
    want: null as string | null,
  },
  {
    name: "ENバッジ突合: 'Tomorrow' と当日ラベルは鳴る",
    fn: () => countdownBadgeProblem("Tomorrow", "Sep 5 (Sat)", calendarDate(2026, 9, 5)) !== null,
    want: true,
  },
  {
    name: "ENバッジ突合: 'In 3 days' は3日先ラベルと一致",
    fn: () => countdownBadgeProblem("In 3 days", "Sep 5 (Sat)", calendarDate(2026, 9, 2)),
    want: null as string | null,
  },
  {
    name: "ENカウントダウン: Today/Tomorrow/In N days",
    fn: () => `${countdownLabelEn(0)}|${countdownLabelEn(1)}|${countdownLabelEn(3)}`,
    want: "Today|Tomorrow|In 3 days",
  },
  {
    name: "EN語彙: 対応表にある種別だけ訳す・無い種別は日本語のまま（断定を足さない）",
    fn: () => `${eventTypeLabel("抽選", "en")}|${eventTypeLabel("エントリー受付中", "en")}`,
    want: "Lottery|エントリー受付中",
  },
  {
    name: "EN語彙: ジャンル・節見出しも同じ規則",
    fn: () => `${genreLabel("フィギュア", "en")}|${genreLabel("未知のジャンル", "en")}|${groupLabel("今日", "en")}`,
    want: "Figures|未知のジャンル|Today",
  },
  {
    name: "投稿・表示層: 英語の禁止語も拾う（大文字小文字を吸収）",
    fn: () => findForbidden("Resell for PROFIT").join(","),
    want: "resell,profit",
  },
  {
    name: "投稿・表示層: 通常の英語本文は禁止語に引っかからない",
    fn: () => findForbidden("Pre-orders open · lottery deadline Sep 5, 23:59 JST").length,
    want: 0,
  },
  {
    name: "表示層スキャン: 英語ソースの 'resale' も拾う",
    fn: () => forbiddenInDisplayText('<p className="x">Great for resale!</p>').join(","),
    want: "resale",
  },

  // ── 入手経路タグ（/en の "Online (JP)"）: 裏取り済みの (収集元,ホスト) の組だけに出す ──
  {
    name: "入手経路: 裏取り済みの組（url側）は online",
    fn: () => isOnlineItem({ source: "takaratomy_mall", url: "https://takaratomymall.jp/shop/g/g4904810079880/" }),
    want: true,
  },
  {
    name: "入手経路: officialUrl 側でも判定する（プレバン）",
    fn: () => isOnlineItem({ source: "figisland_pb", url: null, officialUrl: "https://p-bandai.jp/item/item-1000182906/" }),
    want: true,
  },
  {
    name: "入手経路: 同じホストでも裏取りしていない収集元には出さない",
    fn: () => isOnlineItem({ source: "collabo_cafe", url: "https://www.chiikawamarket.jp/products/x" }),
    want: false,
  },
  {
    name: "入手経路: 企業サイト（store でない medicomtoy.co.jp）には出さない",
    fn: () => isOnlineItem({ source: "medicom_toy", url: "https://www.medicomtoy.co.jp/blog/?p=99999" }),
    want: false,
  },
  {
    name: "入手経路: www は吸収する（SNKRS）",
    fn: () => isOnlineItem({ source: "nike_snkrs", url: "https://www.nike.com/jp/launch/t/air-max-95" }),
    want: true,
  },
  {
    name: "入手経路: 壊れたURL・URL無しは判定しない",
    fn: () =>
      isOnlineItem({ source: "takaratomy_mall", url: "not a url" }) ||
      isOnlineItem({ source: "takaratomy_mall", url: null }),
    want: false,
  },
  {
    name: "入手経路: Amazonの /dp/ 商品ページは online（入荷Now・店舗別トレカ抽選）",
    fn: () =>
      isOnlineItem({ source: "nyuka_now", url: "https://www.amazon.co.jp/dp/B0DDWZWW1Z" }) &&
      isOnlineItem({ source: "card_chusen", url: "https://www.amazon.co.jp/dp/B0GN5JV7JS" }),
    want: true,
  },
  {
    name: "入手経路: Amazonでも /dp/ 以外（検索結果URL）には出さない",
    fn: () =>
      isOnlineItem({
        source: "nyuka_now",
        url: "https://www.amazon.co.jp/s?k=%E3%83%9D%E3%82%B1%E3%83%A2%E3%83%B3%E3%82%AB%E3%83%BC%E3%83%89",
      }),
    want: false,
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
