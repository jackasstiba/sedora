/**
 * データ品質の常設監査（`npm run audit`）。
 *
 * 目的: 「人間なら一瞬で気付く表記/数字/日付の粗」を、その都度目視で探すのではなく、
 * サイトが実際に表示する全件に対して不変条件（invariant）を毎回機械チェックする。
 *
 * 設計上の約束（過去にここを外して粗が素通りした）:
 *  1. **検査対象はページ関数から取る。** 監査が自前でクエリを書くと、ページ側の条件変更や
 *     dedupe の代表選択の違いで「画面に出ているのに監査の外」の行が生まれる（実測: /premium が
 *     丸ごと外、ジャンルページで数件が外）。下の PAGES に登録した関数の**出力そのもの**を見る。
 *     → 新しいページを作ったら PAGES に足す。足し忘れは registry のカバレッジ検査で落ちる。
 *  2. **WARN を放置しない。** 種類ごとの件数を audit-baseline.json に記録し、**増えたら ERROR**
 *     （ラチェット）。「WARNだから通す」を無くすための仕組み。baseline の更新は
 *     `npm run audit -- --update-baseline`（減った時だけ自動で締まる）。増加が正当だと
 *     **中身を確認した上で**受け入れるときだけ `--accept` を併用する。
 *  3. **「無い・0である」も検査する。** 値が変なものだけでなく、あるべきデータが消えたこと
 *     （ソースが更新されない／相場の付与が0件になる）も落とす。機能は静かに死ぬ。
 *
 * 新しい粗の型に気づいたら invariant をここに足す＝「全方位」を言葉でなく実装で担保する。
 */
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/prisma";
import { displayEventDateText, eventDateLabel, isMonthPrecision, isStalePromise, todayJst } from "../src/lib/date";
import { cleanListTitle } from "../src/lib/title";
import { dedupeKey, GENRE_ORDER, INVISIBLE_CHARS, matchesQuery, normalizeForSearch } from "../src/lib/itemFilter";
import { parseYen } from "../src/lib/margin";
import { hasSearchableTitle, isOfficialUrl } from "../src/lib/outbound";
import { parsePrizesJson } from "../src/lib/prizes";
import { parseStoresJson } from "../src/lib/stores";
import { loadDisplayedPages, type DisplayedPage } from "../src/lib/pages";
import { classifyPageLoss, isReportableLoss } from "../src/lib/pageLoss";
import { readPreviousPageIds, runDrift } from "./auditDrift";

type Row = DisplayedPage["rows"][number];

const BASELINE_PATH = path.join(process.cwd(), "audit-baseline.json");
const args = process.argv.slice(2);
const UPDATE_BASELINE = args.includes("--update-baseline");
const CHECK_LINKS = args.includes("--links");

// ── 所見の記録とラチェット ─────────────────────────────────────────────────
type Level = "error" | "warn";
type Finding = { key: string; title: string; level: Level; items: string[]; baseline: number | null };
const findings: Finding[] = [];
const counts: Record<string, number> = {};

// 検査ごとの「母数」＝その検査が実際に何件を見たか。
// **0件という報告は、母数を出さないと意味がない。** 見た上での0なのか、対象が消えていて
// 何も見ていない0なのかが区別できないため（実測: 実況タイトルの検査4種は対象が
// channeltono/rarecheck/x_watch 固定で、掲載基準を変えてこの3ソースが303→27件になった
// 瞬間に、検査は「きれいだから0」ではなく「ほとんど見ていないから0」に変わっていた）。
const coverage: Record<string, number> = {};

/**
 * 検査結果を記録する。level="warn" でも baseline を超えたら ERROR に昇格する。
 * @param examined この検査が見た件数。既定は表示全件。**対象を絞る検査は必ず実数を渡すこと。**
 */
function report(
  key: string,
  title: string,
  level: Level,
  items: string[],
  baseline: Baseline,
  examined?: number
) {
  counts[key] = items.length;
  if (examined !== undefined) coverage[key] = examined;
  const base = baseline.checks?.[key] ?? null;
  if (!items.length) return;
  const exceeded = base !== null && items.length > base;
  findings.push({ key, title, level: exceeded ? "error" : level, items, baseline: base });
}

type Baseline = {
  updatedAt?: string;
  // audit:facts のラチェット（このスクリプトは読まないが、書き戻しで消してはいけない）。
  facts?: { checked: number; findings: number };
  checks?: Record<string, number>;
  pages?: Record<string, number>;
  // 指摘の件数ではなく「機能が生きている量」。0 になったら機能の死なので、
  // 前提条件を必要とする存在検査とは別に、単純な減少で捕まえる。
  metrics?: Record<string, number>;
  // 検査ごとの母数（＝その検査が見た件数）。0 になったら検査が空振りしている。
  coverage?: Record<string, number>;
};
function loadBaseline(): Baseline {
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")) as Baseline;
  } catch {
    return {};
  }
}

const NOISE_CHECKS: { key: string; re: RegExp }[] = [
  // 実況の残骸だけを拾う。「（再販）」「9月再販!」のように商品名・記事見出しとして
  // 正当な語は対象にしない（以前の検出器はこれで大量の誤検知を出し、本物が埋もれていた）。
  { key: "相場・在庫の実況", re: /高騰|ヤフオク|メルカリ|転売|せどり|まだあり|まだいけ|品薄|即完|完売(?:へ|中|多数|だった|です)/ },
  { key: "呼びかけ・感想の残り", re: /お(?:早|はや)めに|ご注意|人気(?:です|かと|順|高|沸騰|爆発)|(?:です|ます)[！!]\s*$|かと\s*$|そうです\s*$/ },
  { key: "店舗＋受付の告知", re: /(?:で|にて)(?:の)?(?:販売|予約)(?:再開|開始)(?:きたー|中|です)/ },
  { key: "値引き・ポイント告知", re: /[０-９0-9]{1,3}\s*[％%]\s*オフ|楽天カード\s*\d+\s*倍|お買い物マラソン|楽天スーパーDEAL/ },
];

// 検索ボックスのプレースホルダが例示している語（src/components/FilterBar.tsx と揃える）。
// 例示する以上、0件であってはならない。
const SEARCH_PLACEHOLDER_EXAMPLES = ["初音ミク", "ポケカ"];
// 表記ゆれの正規化が効いているかを確かめる語（全角型番・不可視文字・半角記号）。
const SEARCH_NORMALIZE_PROBES = ["hg", "mg", "rg", "ぬいぐるみ", "コカ・コーラ"];

async function main() {
  const baseline = loadBaseline();
  // 「機能が生きている量」。--update-baseline のときだけ記録を進める（＝受け入れた状態）。
  const metrics: Record<string, number> = {};
  const today = todayJst();
  const curYear = today.getUTCFullYear();

  // 直前の実行のページ別 id は、runDrift がプロファイルを上書きする前に読む必要がある。
  const prevPageIds = readPreviousPageIds();

  const pages = await loadDisplayedPages();
  // 全ページの和集合＝「サイトが今見せている全件」。個別の検査はこれに対して回す。
  const byId = new Map<number, Row>();
  for (const p of pages) for (const r of p.rows) byId.set(r.id, r);
  const shown = [...byId.values()];
  const all = await prisma.item.findMany({ take: 100000 });
  // データの状態。同じデータのまま audit を回し直しても、ページ比較の参照点を進めないための鍵。
  const dataFingerprint = `${all.length}:${Math.max(...all.map((r) => new Date(r.scrapedAt).getTime()), 0)}`;

  console.log("== ハツコレ データ監査 ==");
  console.log(`ページ ${pages.length}種 / 表示される実体 ${shown.length}件 / DB全体 ${all.length}件 / 基準日 ${today.toISOString().slice(0, 10)}`);
  console.log(pages.map((p) => `${p.name}:${p.rows.length}`).join("  "));
  console.log("");

  // (0) ページ登録のカバレッジ。DB に居て一覧に出る条件を満たすのに、どのページにも
  //     現れない＝登録漏れか、意図しない除外。どちらも知りたいので数える。
  {
    const upcoming = all.filter((r) => !r.eventDate || r.eventDate >= today);
    const missing = upcoming.filter((r) => !byId.has(r.id));
    console.log(`(参考) 今後＋日付未定 ${upcoming.length}件のうち、どのページにも出ないもの ${missing.length}件（重複解消・非商品投稿の除外を含む）`);
  }

  // (1) 整形後タイトルに残る実況の断片。
  //     対象は実況本文をタイトルにしているXミラー系だけ。他ソースは公式・記事の正規タイトルで、
  //     「くじを手にする戦いなのです！」のような正当な商品名を実況と誤検知してしまう。
  const MIRROR_SOURCES = new Set(["channeltono", "rarecheck", "x_watch"]);
  const mirrorRows = shown.filter((r) => MIRROR_SOURCES.has(r.source));
  for (const { key, re } of NOISE_CHECKS) {
    const bad: string[] = [];
    for (const r of mirrorRows) {
      const c = cleanListTitle(r.source, r.title);
      if (re.test(c)) bad.push(`[${r.source} #${r.id}] ${c}`);
    }
    report(`title_noise:${key}`, `タイトルに実況が残る（${key}）`, "error", bad, baseline, mirrorRows.length);
  }

  // (1a) 収集元の区切り記号がタイトルに残っている。**ソースを問わない客観的な粗**。
  //      実況の検査（上）はXミラー限定で正しい（他ソースに広げると「くじを手にする戦いなのです！」
  //      のような正当な商品名を誤検知する。実測で確認済み）。一方これは、商品名にパイプが
  //      出てこない以上どのソースでも誤り＝全件を母数にできる。
  //      実測: トレカ速報の8件が「【MTG】| ホビット コレクター・ブースター」だった。
  {
    const bad = shown
      .filter((r) => /[|｜]/.test(cleanListTitle(r.source, r.title)))
      .map((r) => `[${r.source} #${r.id}] ${cleanListTitle(r.source, r.title)}`);
    report("title_pipe_residue", "タイトルに収集元の区切り記号が残っている", "error", bad, baseline, shown.length);
  }

  // (1b) 商品名が特定できない投稿（ニュース/速報の実況記事）。掲載自体を見直す対象。
  {
    const bad = shown
      .filter((r) => /^【(?:ニュース|速報)】/.test(cleanListTitle(r.source, r.title)))
      .map((r) => `[${r.source} #${r.id}] ${cleanListTitle(r.source, r.title)}`);
    report("news_post", "商品ではないニュース投稿が掲載されている", "warn", bad, baseline);
  }

  // (2) 同じページの中に同じ商品が2枚出ていないか（クロスソース／同一ソースの両方）。
  //     ※ 長さの下限を設けない。以前は正規化キー8字未満を検査から外していたため、
  //       「コービー 5」の二重掲載が検査も解消もされないまま本番に出ていた。
  {
    const crossBad: string[] = [];
    const sameBad: string[] = [];
    for (const p of pages) {
      const loose = new Map<string, Row[]>();
      const exact = new Map<string, Row[]>();
      for (const it of p.rows) {
        const lk = [...dedupeKey(cleanListTitle(it.source, it.title))].sort().join("");
        if (lk.length >= 8) (loose.get(lk) ?? loose.set(lk, []).get(lk)!).push(it);
        const ek = `${it.source}|${it.title}`;
        (exact.get(ek) ?? exact.set(ek, []).get(ek)!).push(it);
      }
      for (const arr of loose.values()) {
        if (arr.length < 2) continue;
        if (new Set(arr.map((x) => x.source)).size < 2) continue;
        crossBad.push(`${p.name}: ` + arr.map((x) => `${x.source}#${x.id}:${cleanListTitle(x.source, x.title)}`).join("  ||  "));
      }
      for (const arr of exact.values()) {
        if (arr.length < 2) continue;
        sameBad.push(`${p.name}: ` + arr.map((x) => `#${x.id}`).join(" ") + ` ${cleanListTitle(arr[0].source, arr[0].title)}`);
      }
    }
    report("dup_cross", "同じページにクロスソース重複が残っている", "error", crossBad, baseline);
    report("dup_exact", "同じページに同一ソース・同一タイトルが二重掲載", "error", sameBad, baseline);
  }

  // (3) 抽選まわりの断定。裏取りできていない表示は出さない（原則: 確認済みのみ約束）。
  //     ※ ソースのホワイトリストで検査対象を絞らない。絞ると新しいソースを足した瞬間に
  //       検査から外れ、未確認の断定が素通りする（実際に tenbaiquest がそうなっていた）。
  //       仕組み表記を持たないソースだけを、理由付きでここに明示する。
  {
    const HL_IS_STORE_LIST = new Set(["nyuka_now", "tenbaiquest"]); // highlights が受付中ストアの一覧
    const badPrize: string[] = [];
    const badFlag: string[] = [];
    const noEvidence: string[] = [];
    for (const r of shown) {
      const h = r.highlights ?? "";
      if (/賞品[:：]/.test(h) && !h.includes("各賞ラインナップ")) badPrize.push(`[${r.source} #${r.id}] ${h}`);
      if (HL_IS_STORE_LIST.has(r.source)) continue;
      // 「賞品ラインナップ：」は一次くじプラットフォーム(raffle_kuji)が出す各賞一覧＝抽選の根拠。
      if (r.hasLottery && h && !/抽選|くじ|各賞ラインナップ|賞品ラインナップ/.test(h))
        badFlag.push(`[${r.source} #${r.id}] hasLottery=true だが highlights に抽選表記なし: ${h}`);
      if (!r.hasLottery && /抽選・くじあり|抽選賞品/.test(h))
        badFlag.push(`[${r.source} #${r.id}] hasLottery=false だが抽選表記: ${h}`);
      // 抽選だと表示するなら、その根拠（賞品ラインナップ等）が無いとおかしい。
      if (r.hasLottery && !h && !r.prizes)
        noEvidence.push(`[${r.source} #${r.id}] hasLottery=true だが根拠(highlights/prizes)なし ${cleanListTitle(r.source, r.title)}`);
    }
    report("lottery_prize_claim", "抽選: 未確認の『賞品』断定ラベル", "error", badPrize, baseline);
    report("lottery_flag", "抽選: hasLottery と表記の不整合", "error", badFlag, baseline);
    report("lottery_no_evidence", "抽選: 根拠なしで抽選と表示している", "warn", noEvidence, baseline);
  }

  // (4) 価格の健全性
  {
    const bad: string[] = [];
    for (const r of shown) {
      if (!r.price) continue;
      const y = parseYen(r.price.split(" / ")[0]);
      const t = cleanListTitle(r.source, r.title);
      const isBoxWord = /BOX|ＢＯＸ|box|箱|入り|カートン|セット/.test(r.title);
      // 「パック」はトレカだけの単位ではない。プラモの「ストライカーパック」「拡張パーツ
      // パック」は部品セットで、単価が数千円でも正常（実測で ＭＧ 1/100 …ストライカーパック
      // 3,520円 を誤検知した）。カードの単パックという概念があるトレカ系に限定する。
      const isCardGenre = r.genre === "トレカ" || r.genre === "ポケモン";
      const isSinglePack = isCardGenre && /(?:ブースター|スターター)?パック/.test(t) && !isBoxWord;
      if (y != null && isSinglePack && y >= 3000) bad.push(`[${r.source} #${r.id}] ${y.toLocaleString()}円(BOX表記なしの単パック?) ${t}`);
      if (y != null && (y <= 0 || y > 3_000_000)) bad.push(`[${r.source} #${r.id}] 異常価格 ${r.price} ${t}`);
    }
    report("price_sanity", "価格の疑い（単パックがBOX価格 / 異常値）", "warn", bad, baseline);
  }

  // (5) 相場（marketPrice）の健全性。相場降順のページなので誤りほど上位＝最も目立つ。
  {
    const ratioBad: string[] = [];
    const labelBad: string[] = [];
    for (const r of shown) {
      if (r.marketPrice == null) continue;
      const label = r.marketPriceText ?? "";
      if (!/中古|新品|メルカリ|実売|落札/.test(label))
        labelBad.push(`[${r.source} #${r.id}] 種別不明の相場表記「${label}」 ${cleanListTitle(r.source, r.title)}`);
      const face = r.price ? parseYen(r.price.split(" / ")[0]) : null;
      if (face && face > 0 && r.marketPrice >= face * 20)
        ratioBad.push(
          `[${r.source} #${r.id}] 定価${face.toLocaleString()}円 → 相場${r.marketPrice.toLocaleString()}円 (${Math.round(r.marketPrice / face)}倍) ${cleanListTitle(r.source, r.title)}`
        );
    }
    report("market_ratio", "相場が定価の20倍以上（単品↔BOX/カートンの取り違え疑い）", "error", ratioBad, baseline);
    report("market_label", "相場ラベルが実体不明（中古/新品以外を相場として表示）", "error", labelBad, baseline);
  }

  // (6) ジャンルの語彙と分類ブレ
  {
    const unknown = new Map<string, number>();
    for (const r of all) if (!GENRE_ORDER.includes(r.genre)) unknown.set(r.genre, (unknown.get(r.genre) ?? 0) + 1);
    report(
      "genre_vocab",
      "語彙に無いジャンルが使われている（表示順・絞り込みから漏れる）",
      "error",
      [...unknown.entries()].map(([g, n]) => `「${g}」${n}件`),
      baseline
    );

    const g = new Map<string, Set<string>>();
    const ex = new Map<string, string[]>();
    for (const it of shown) {
      const key = dedupeKey(cleanListTitle(it.source, it.title));
      if (key.length < 10) continue;
      (g.get(key) ?? g.set(key, new Set()).get(key)!).add(it.genre);
      (ex.get(key) ?? ex.set(key, []).get(key)!).push(`${it.genre}#${it.id}`);
    }
    const bad: string[] = [];
    for (const [k, genres] of g) if (genres.size >= 2) bad.push(`${[...genres].join("/")}: ${ex.get(k)!.join(" ")}`);
    report("genre_split", "同名商品が別ジャンルに分類されている", "warn", bad, baseline);
  }

  // (7) 日付の健全性（一覧に過去/遠すぎる未来が出ていないか）
  {
    const bad: string[] = [];
    for (const p of pages) {
      if (p.name.startsWith("/release/") || p.name === "/premium") continue; // 過去も意図して載せるページ
      for (const r of p.rows) {
        if (!r.eventDate) continue;
        const d = new Date(r.eventDate);
        if (d < today) bad.push(`${p.name} [${r.source} #${r.id}] 過去日 ${d.toISOString().slice(0, 10)} ${cleanListTitle(r.source, r.title)}`);
        if (d.getUTCFullYear() > curYear + 2)
          bad.push(`${p.name} [${r.source} #${r.id}] 遠未来 ${d.toISOString().slice(0, 10)} ${cleanListTitle(r.source, r.title)}`);
      }
    }
    report("date_sanity", "日付の健全性（過去/遠未来の混入）", "error", bad, baseline);
  }

  // (8) タイトル中の日付とバッジ(eventDate)の食い違い。系統的な±1日ズレは TZ バグ。
  {
    const bad: string[] = [];
    let compared = 0;
    const offsets = new Map<number, number>();
    for (const r of shown) {
      if (!r.eventDate) continue;
      // 「8月8日」型のみ。「8/8」型はプラモの縮尺（1/144 等）と区別できず誤検知になる。
      // 「8月8日まで」は**終了日**であって開催日ではない。バッジ（開始日）と食い違って当然なので
      // 突合の対象から外す（実測 #35299「8月8日まで仙台七夕まつりに掲出!」＝開催 8/6〜8/8）。
      // 締切・終了を表す助詞が続く日付を比較すると、正しいデータを誤りとして鳴らし続ける。
      const hits = [...r.title.matchAll(/(\d{1,2})\s*月\s*(\d{1,2})\s*日(?!\s*(?:まで|迄))/g)]
        .map((m) => ({ mm: Number(m[1]), dd: Number(m[2]) }))
        .filter((x) => x.mm >= 1 && x.mm <= 12 && x.dd >= 1 && x.dd <= 31);
      if (hits.length !== 1) continue;
      const { mm, dd } = hits[0];
      const d = new Date(r.eventDate);
      compared++;
      if (d.getUTCMonth() + 1 === mm && d.getUTCDate() === dd) continue;
      const off = Math.round((d.getTime() - Date.UTC(d.getUTCFullYear(), mm - 1, dd)) / 86_400_000);
      offsets.set(off, (offsets.get(off) ?? 0) + 1);
      bad.push(
        `[${r.source} #${r.id}] バッジ ${d.toISOString().slice(0, 10)} ↔ タイトル ${mm}/${dd}${Math.abs(off) === 1 ? "（1日ズレ）" : ""} ${cleanListTitle(r.source, r.title)}`
      );
    }
    const offBy1 = (offsets.get(1) ?? 0) + (offsets.get(-1) ?? 0);
    const systematic = compared >= 30 && offBy1 >= 10 && offBy1 >= compared * 0.1;
    report(
      "date_title_mismatch",
      `日付の食い違い（タイトル↔バッジ）${systematic ? `／±1日ズレ ${offBy1}件が集中＝TZバグ疑い` : ""}`,
      systematic ? "error" : "warn",
      bad,
      baseline
    );
    console.log(`(参考) タイトルに日付が1つだけある ${compared}件を突合 / 食い違い ${bad.length}件`);
  }

  // (9) タイトル末尾の宙ぶらりん助詞（文が途中で切れた痕跡）
  {
    const bad: string[] = [];
    for (const r of shown) {
      const c = cleanListTitle(r.source, r.title);
      if (/[ぁ-ん一-龥][でにをはがのへ]$/.test(c) && /\s/.test(c)) bad.push(`[${r.source} #${r.id}] ${c}`);
    }
    report("dangling_particle", "タイトル末尾が宙ぶらりん助詞（文の途中で切れた痕跡）", "warn", bad, baseline);
  }

  // (9c) 年が推測で入った疑いのある遠い未来の日付。
  //
  // 年の無い「4月28日」を**今日**基準で解決していたため、数ヶ月前の記事に書かれた過去の日付が
  // 「まだ来ていない日」と解釈されて翌年に倒れていた（実測: rarecheck の掲載9件中7件が
  // 2027年4〜6月＝実際は2026年）。基準点を記事の投稿日に直したが、**収集元のフィードから
  // 消えた古い行は通常のスクレイプで洗われない**（ミス13）ので、残骸を機械で見つける。
  // 日付テキストに年が書かれていないのに1年以上先を指しているものだけを対象にする
  // （元から「2027年」と書いてある正当な先行情報は鳴らさない）。
  {
    const oneYear = new Date(today);
    oneYear.setUTCFullYear(oneYear.getUTCFullYear() + 1);
    const bad: string[] = [];
    for (const r of shown) {
      if (!r.eventDate || new Date(r.eventDate) <= oneYear) continue;
      if (/\d{4}\s*年|\d{4}[/-]/.test(r.eventDateText ?? "")) continue; // 元テキストに年がある＝推測でない
      bad.push(
        `[${r.source} #${r.id}] ${new Date(r.eventDate).toISOString().slice(0, 10)}（元テキスト「${r.eventDateText ?? "-"}」に年が無い）${cleanListTitle(r.source, r.title).slice(0, 34)}`
      );
    }
    report("date_year_guessed", "年が書かれていないのに1年以上先の日付になっている", "error", bad, baseline);
  }

  // (9b) 期限切れの約束ラベル。「予約受付中 / 2023年4月発送予定」のように、**今から行動できると
  //      読めるラベル**なのに予定日が過ぎている行。発売・開催・抽選は過去日でも事実として
  //      正しい（発売済みは相場の価値がある）ので対象にしない。
  //      実測: 「予約受付中 / 2023年4月発送予定」171件 + 「登場予定 / 2ヶ月前」45件。
  //      収集元の記事が当時の表記で凍結し、こちらも一度取得した行は詳細を再取得しない
  //      設計だったため、通常の更新では永久に直らない型だった。
  //      **画面に出る文字列で判定する**（displayEventType 経由）。データ側の eventType で
  //      鳴らすと、表示層で直しているものまで鳴り続けて決して0にならない検査になる。
  {
    const bad: string[] = [];
    for (const r of shown) {
      if (isStalePromise(r.eventType, r.eventDate, r.eventDateText, today))
        bad.push(`[${r.source} #${r.id}] ${r.eventType} / ${r.eventDateText ?? "-"} ${cleanListTitle(r.source, r.title)}`);
    }
    report("stale_promise", "期限が過ぎているのに「受付中/登場予定」と表示している", "error", bad, baseline);
  }

  // (9a) 文字そのものの異常。**目視では見つけられない層**なので機械でしか守れない。
  //      実測: collabo_cafe のタイトルにゼロ幅スペースが混入し（「ぬいぐる​み」）、
  //      見た目は正常なまま検索・重複判定を壊していた（検索の取りこぼし59件の一部）。
  {
    // ※ g フラグ付きの正規表現を .test() に使うと lastIndex が持ち越され、
    //   同じ入力でも呼ぶたびに結果が変わる。判定用にフラグ無しのコピーを作る。
    const invisibleRe = new RegExp(INVISIBLE_CHARS.source);
    const invisible: string[] = [];
    const broken: string[] = [];
    const spacing: string[] = [];
    for (const r of shown) {
      const t = cleanListTitle(r.source, r.title);
      const fields: [string, string][] = [["タイトル", t]];
      if (r.highlights) fields.push(["要約", r.highlights]);
      for (const [where, v] of fields) {
        if (invisibleRe.test(v)) invisible.push(`[${r.source} #${r.id}] ${where}に不可視文字: ${JSON.stringify(v.slice(0, 40))}`);
        if (/�|[ --]/.test(v))
          broken.push(`[${r.source} #${r.id}] ${where}に文字化け/制御文字: ${JSON.stringify(v.slice(0, 40))}`);
        if (/^[\s　]|[\s　]$|　{3,}/.test(v)) spacing.push(`[${r.source} #${r.id}] ${where}の空白が異常: ${JSON.stringify(v.slice(0, 40))}`);
      }
    }
    report("text_invisible", "表示テキストに不可視文字が混入（検索・重複判定を壊す）", "error", invisible, baseline);
    report("text_broken_char", "表示テキストに文字化け・制御文字", "error", broken, baseline);
    report("text_spacing", "表示テキストの空白が異常（前後の空白・全角3連）", "warn", spacing, baseline);
  }

  // (9a2) 検索が実際に当たるか。
  //   ・UIがプレースホルダで例示している語が0件なら、それは案内が嘘をついている
  //     （実測で過去に「ポケカ」が0件だった）。例示する以上は当たらなければならない。
  //   ・表記ゆれの正規化が効いているか（全角「ＨＧ」を「hg」で引けるか等）。
  //     正規化が外れると、見た目は何も壊れていないのに検索だけが静かに痩せる。
  {
    const bad: string[] = [];
    for (const q of SEARCH_PLACEHOLDER_EXAMPLES) {
      const n = shown.filter((r) => matchesQuery(r.title, q.toLowerCase())).length;
      if (n === 0) bad.push(`検索例「${q}」が0件（UIが例示しているのに当たらない）`);
    }
    // 正規化の実効性: 正規化した本文に含まれるのに matchesQuery が拾えない件数。
    let missed = 0;
    for (const q of SEARCH_NORMALIZE_PROBES) {
      const should = shown.filter((r) => normalizeForSearch(r.title).includes(normalizeForSearch(q)));
      const got = should.filter((r) => matchesQuery(r.title, q.toLowerCase()));
      if (got.length < should.length) {
        missed += should.length - got.length;
        bad.push(`「${q}」: 本来 ${should.length}件のうち ${should.length - got.length}件を取りこぼし（表記ゆれの正規化が効いていない）`);
      }
    }
    report("search_broken", "検索が当たらない（例示語が0件／正規化漏れ）", "error", bad, baseline);
    console.log(`(参考) 検索: 例示語 ${SEARCH_PLACEHOLDER_EXAMPLES.length}種・正規化プローブ ${SEARCH_NORMALIZE_PROBES.length}種を確認 / 取りこぼし ${missed}件`);
  }

  // (9a3) 元情報より高い精度を表示していないか（＝こちらが精度を捏造していないか）。
  //   実測: プレミアムバンダイの79件は元が「2026年9月発送予定」なのに、eventDate の月初が
  //   そのまま「9/1(火)」として発売日と同じ赤字で出ていた（表示日の分布が全件1日＝合成の証拠）。
  //   日付の正確さはこのサイトの中核価値なので、**分かっている精度でしか書かない**。
  {
    const bad: string[] = [];
    for (const r of shown) {
      if (!r.eventDate || !isMonthPrecision(r.eventDateText)) continue;
      const label = eventDateLabel(r.eventDate, r.eventDateText, "short");
      // 月精度の情報なのに、ラベルに「日」相当（M/D 形式）が出ていたら捏造。
      if (label && /\d{1,2}\/\d{1,2}/.test(label))
        bad.push(`[${r.source} #${r.id}] 元は «${r.eventDateText}» なのに「${label}」と特定日で表示`);
    }
    report("date_fabricated_precision", "月までしか分からない情報を特定日として表示している", "error", bad, baseline);
    const monthOnly = shown.filter((r) => r.eventDate && isMonthPrecision(r.eventDateText)).length;
    console.log(`(参考) 月精度の情報 ${monthOnly}件は「YYYY年M月」で表示（特定日にしない）`);
  }

  // (9a4) リンク先が個別の商品ページになっているか。
  //   同じURLを複数の商品が共有していたら、少なくともどれかは「商品ページに送れていない」。
  //   実測: pokemoncard の2件が一覧ページ（/products/）止まりで、クリックしても商品に辿り着けない。
  //   ただし1つの抽選ページが複数商品を本当に扱う場合もある（近鉄百貨店のウイスキー4種）ので、
  //   断定せず数える。増えたらラチェットで ERROR になる。
  {
    // 1つのページが複数商品を本当に扱うソースは対象外にする。ここを分けないと、
    // 正常な構造に対して毎回鳴り続け、本当の指摘（商品ページに送れていない）が埋もれる。
    const PAGE_COVERS_MANY: Record<string, string> = {
      nyuka_now: "1つの抽選ページで複数商品の応募を受け付ける（百貨店のウイスキー3種など）",
      pokemon_goods: "1つのキャンペーン特集ページに複数グッズが載る",
      nike_snkrs: "1つの launch ページに大人用とキッズ用が並ぶ",
    };
    const byUrl = new Map<string, Row[]>();
    for (const r of shown) (byUrl.get(r.url) ?? byUrl.set(r.url, []).get(r.url)!).push(r);
    const bad: string[] = [];
    for (const [url, arr] of byUrl) {
      if (arr.length < 2) continue;
      if (arr.every((x) => PAGE_COVERS_MANY[x.source])) continue;
      bad.push(
        `${arr.length}件が同じURLを共有 → ${url}\n        ` +
          arr.slice(0, 3).map((x) => `[${x.source} #${x.id}] ${cleanListTitle(x.source, x.title).slice(0, 34)}`).join("\n        ")
      );
    }
    report("shared_url", "複数の商品が同じリンク先を指している（個別ページに送れていない）", "warn", bad, baseline);
  }

  // (9b) 括弧の対応が取れていない表示タイトル。
  //      ランダム標本の目視で見つかった型（『で始まって閉じない）。人間なら一瞬で気付く。
  {
    const pairs: [string, string][] = [["『", "』"], ["「", "」"], ["【", "】"], ["（", "）"]];
    const bad: string[] = [];
    for (const r of shown) {
      const t = cleanListTitle(r.source, r.title);
      for (const [open, close] of pairs) {
        if (t.split(open).length !== t.split(close).length) {
          bad.push(`[${r.source} #${r.id}] ${open}${close} の対応なし: ${t}`);
          break;
        }
      }
    }
    report("unbalanced_bracket", "表示タイトルの括弧が閉じていない", "warn", bad, baseline);
  }

  // (9c) 日付欄に「発売日でないもの」を出していないか。
  //      日付欄は発売日と同じ赤字なので、そこに出た文字列は発売日として読まれる。
  //      実測: Xミラー由来の275件が「投稿日: 2026-08-07」（記事を拾った日）を表示していた。
  //      裏取り済みの事実だけを約束する原則（[[UIラベルは裏取り済みのみ約束]]）の日付版。
  {
    const bad: string[] = [];
    const pastText: string[] = [];
    for (const r of shown) {
      if (r.eventDate) continue;
      // 検査するのは**画面に出る文字列**。DBの生の値ではなく、表示層を通した結果を見る。
      const label = displayEventDateText(r.eventDateText);
      if (!label) continue;
      if (/投稿日|掲載日|更新日/.test(label))
        bad.push(`[${r.source} #${r.id}] 日付欄に «${label}» ${cleanListTitle(r.source, r.title)}`);
      // 「これから◯◯する」と読める表記なのに、日付が過去を指している＝陳腐化した予定。
      // ※「登場 2026/07/31」のように**既に起きたこと**を書いている表記は正常（ポケモン公式の
      //   新商品は"今買える"意味で過去日を持つ）。予定を約束する語がある時だけ粗とみなす。
      //   正常を故障と鳴らす検査は、すぐ読み飛ばされるようになる。
      if (!/予定|開始|受付|締切|まで/.test(label)) continue;
      // 日付の読み取りは、書式ごとに明示的に分ける。ここは2回間違えた:
      //  ・曖昧な `\D{0,2}` で「2026年08月下旬」を「2026年0月8日」と読み、過去と誤判定（180件）
      //  ・「2026年08月05週」（8月第5週＝月末）を 8月5日と読み、過去と誤判定（93件）
      // 「それらしく読めてしまう」書式ほど危ない。週表記を先に処理し、日が無い表記は判定しない。
      const week = label.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(?:第)?\s*(\d{1,2})\s*週/);
      const ymd = label.match(/(\d{4})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})\s*日?(?!\s*週)/);
      const d = week
        ? Date.UTC(Number(week[1]), Number(week[2]) - 1, (Number(week[3]) - 1) * 7 + 1)
        : ymd
          ? Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]))
          : null;
      if (d !== null && d < today.getTime())
        pastText.push(`[${r.source} #${r.id}] 予定が過去 «${label}» ${cleanListTitle(r.source, r.title)}`);
    }
    report("date_text_not_event", "日付欄に発売日でないものを出している", "error", bad, baseline);
    report("date_text_past", "日付欄のテキストが過去を指している（陳腐化）", "warn", pastText, baseline);
  }

  // (10) 一番くじの各賞（prizes JSON）。構造の壊れと、**相場が1件も付いていない=機能の死**。
  {
    const broken: string[] = [];
    let prizeItems = 0;
    let prizeRows = 0;
    let resaleRows = 0;
    const suspect: string[] = [];
    for (const r of all) {
      if (!r.prizes) continue;
      prizeItems++;
      const p = parsePrizesJson(r.prizes);
      if (!p) {
        broken.push(`#${r.id} prizes が壊れている ${r.title.slice(0, 40)}`);
        continue;
      }
      const face = r.price ? parseYen(r.price.split(" / ")[0]) : null;
      for (const x of p) {
        prizeRows++;
        if (!x.name) broken.push(`#${r.id} 賞名なし ${x.label}`);
        if (x.resalePrice == null) continue;
        resaleRows++;
        if (x.resaleText && !/中古|新品|メルカリ|実売|落札/.test(x.resaleText))
          suspect.push(`#${r.id} ${x.label} 種別不明の相場表記「${x.resaleText}」`);
        if (face && face > 0 && x.resalePrice >= face * 40)
          suspect.push(`#${r.id} 1回${face}円 → ${x.label} ${x.resalePrice.toLocaleString()}円（${Math.round(x.resalePrice / face)}倍）`);
      }
    }
    report("prizes_broken", "一番くじの各賞データが壊れている", "error", broken, baseline, prizeItems);
    report("prizes_resale_suspect", "各賞の二次相場が疑わしい", "error", suspect, baseline, prizeRows);
    // 存在検査: 機能が静かに死んでいないか。
    // ※ 駿河屋の中古は発売済みにしか付かないので、未発売くじで0件なのは正常。
    //   「発売から十分に経った」くじだけを母数にしないと、正常を故障と誤報する。
    const ripe = new Date(today);
    ripe.setUTCDate(ripe.getUTCDate() - 14);
    const ripeKuji = all.filter((r) => r.prizes && r.eventDate && r.eventDate < ripe);
    const ripeWithResale = ripeKuji.filter((r) => /"resalePrice"/.test(r.prizes!));
    const dead =
      ripeKuji.length >= 5 && ripeWithResale.length === 0
        ? [`発売から14日以上経ったくじ ${ripeKuji.length}件のどれにも二次相場が付いていない（scrape:kuji:prices が機能していない疑い）`]
        : [];
    report("prizes_resale_missing", "各賞の二次相場が1件も付かない（機能が死んでいる疑い）", "error", dead, baseline, ripeKuji.length);

    // **上の検査は前提条件（発売から14日以上のくじが5件以上）が満たされないと発火できない。**
    // 実測でその状態のまま、付与済みの二次相場が再スクレイプに潰されて 1件→0件 になったのを
    // 素通りさせた。前提の要らない見方＝「**前より減った**」を別に持つ（ラチェットが検出する）。
    // 相場は増える方向にしか動かないはず（付与はするが取り消しは prices:recheck だけ）。
    const baselineResale = baseline.metrics?.prizes_resale;
    const lost = resaleRows === 0 && (baselineResale ?? 0) > 0
      ? [`二次相場が ${baselineResale}件 → 0件 に消えた（巡回で上書きされた疑い。scrape:kuji:prices を回し直す）`]
      : [];
    report("prizes_resale_lost", "付いていた二次相場が消えた", "error", lost, baseline);
    metrics.prizes_resale = resaleRows;

    console.log(
      `(参考) 一番くじ各賞: ${prizeItems}件 / ${prizeRows}賞 / 二次相場 ${resaleRows}件` +
        `（発売から14日以上 ${ripeKuji.length}件・うち相場付き ${ripeWithResale.length}件）`
    );
  }

  // (11) 受付中ストア（stores JSON）の構造
  {
    const bad: string[] = [];
    let storeItems = 0;
    for (const r of all) {
      if (!r.stores) continue;
      storeItems++;
      try {
        const arr = JSON.parse(r.stores);
        if (!Array.isArray(arr) || !arr.length) {
          bad.push(`#${r.id} stores が空`);
          continue;
        }
        for (const s of arr) {
          // url は任意（2026-08-10〜）。複数店舗開催のコラボは、収集元の地図リンクが1つしか
          // 無くどの店のものか特定できないので**あえて紐づけない**。名前が無い行だけが壊れ。
          // ※ ここを直さないまま stores を拡張したら、この検査が260件を「壊れている」と
          //   誤報した（直した層＝表示、検査した層＝データ、のズレ。ミス14と同型）。
          if (!s?.name) bad.push(`#${r.id} ストアの name 欠落`);
          else if (s.url != null && !/^https?:\/\//.test(s.url))
            bad.push(`#${r.id} 不正なストアURL ${s.url}`);
        }
      } catch {
        bad.push(`#${r.id} stores の JSON が壊れている`);
      }
    }
    report("stores_broken", "受付中ストアのデータが壊れている", "error", bad, baseline, storeItems);

    // 表示上まったく同じ文字列が並ぶと、読む側には区別がつかない（人間なら一瞬で気付く）。
    // データが正しくても「表示が同じ」なら粗。カードの要約文と詳細のラベルの両方を見る。
    // ※ 検査するのは「実際に画面に出る文字列」だけ。詳細ページは同一ラベルの行に
    //   「応募ページ 1/2」を付けて区別済みなので、データ側に同じラベルが複数あること自体は
    //   粗ではない。データを理由に鳴らすと**決して0にならない検査**になり、網全体の信用を削る。
    const indistinguishable: string[] = [];
    for (const r of shown) {
      // カード/一覧に出る要約文に、同じ表記が2回出ていないか。
      const summary = (r.highlights ?? "").replace(/^受付中ストア：/, "");
      if (!summary) continue;
      const segs = summary.split("、").map((s) => s.trim()).filter(Boolean);
      if (new Set(segs).size < segs.length)
        indistinguishable.push(`[${r.source} #${r.id}] 要約に同一表記が重複: ${summary}`);
    }
    report("stores_indistinguishable", "受付中ストアの表示が区別できない（同じ表記が並ぶ）", "warn", indistinguishable, baseline);
  }

  // (12) 鮮度: ソースごとの最終取得。古いまま表示され続けるのが一番気付きにくい。
  {
    const last = new Map<string, number>();
    const count = new Map<string, number>();
    for (const r of all) {
      const t = new Date(r.scrapedAt).getTime();
      last.set(r.source, Math.max(last.get(r.source) ?? 0, t));
      count.set(r.source, (count.get(r.source) ?? 0) + 1);
    }
    // 毎回の scrape で全件を取り直さない設計のソースは、scrapedAt が古いのが正常。
    // ただし「古いデータが表示され続けている」事実は変わらないので、黙らせずWARNで数える。
    // ※ figisland_pb をここから外した（2026-08-10）。「価格取得済みは再取得しない」設計を
    //   やめ、最終取得が古い順にローテーションで一巡させるようにしたので、**古いまま残るのは
    //   もはや正常ではなくバグ**（実測: この免除があったせいで、250件が20日間凍結し発送月が
    //   2ヶ月ずれていたのを、監査は「設計上そういうもの」と説明して通していた）。
    const BY_DESIGN: Record<string, string> = {
      x_watch: "手動のX巡回で取り込むため自動更新されない",
    };
    const stale: string[] = [];
    const staleByDesign: string[] = [];
    for (const [src, t] of last) {
      const days = (Date.now() - t) / 86_400_000;
      if (days < 3) continue;
      const line = `${src}: ${count.get(src)}件が ${Math.round(days)}日前の取得のまま`;
      if (BY_DESIGN[src]) staleByDesign.push(`${line}（${BY_DESIGN[src]}）`);
      else stale.push(line);
    }
    report("source_stale", "更新が止まっているソースがある", "error", stale, baseline);
    report("source_stale_by_design", "設計上更新されないソースの鮮度", "warn", staleByDesign, baseline);

    // (12b) **サイト全体の最終更新**。1ソースずつ見る (12) は「全部まとめて止まった」を
    // 取り逃がす（全ソースが同じ日に止まれば、どれも“相対的には”おかしくない）。
    //
    // これが無かったせいで起きたこと（2026-08-10 に判明）:
    // 定例更新 run_scrape.bat は **2026-07-21 以降ずっと1度も動いていなかった**。
    // タスクスケジューラに登録が無く（setup bat が未実行）、しかも bat 自体が日本語 rem 行で
    // 起動即死していた。公開サイトの「最終更新」が丸1日以上前という形で表に出ていたのに、
    // 誰も（何も）それを見張っていなかった。**定期実行を前提にする機能は、その定期実行が
    // 生きていること自体を検査する。**
    const newest = Math.max(...all.map((r) => new Date(r.scrapedAt).getTime()), 0);
    const hours = newest ? (Date.now() - newest) / 3_600_000 : Infinity;
    // 巡回は1日2回（8:00/20:00）。1回飛ぶのは在席状況で起こりうるので、2回連続で
    // 飛んだ相当（>30時間）を異常とする。
    report(
      "site_update_stalled",
      "サイト全体の更新が止まっている（定例巡回が動いていない疑い）",
      "error",
      hours > 30
        ? [`最終更新が ${Math.round(hours)}時間前（最新の scrapedAt = ${new Date(newest).toISOString()}）。run_scrape.bat とタスク HatsukoreScrape_AM/PM の稼働を確認すること`]
        : [],
      baseline,
      all.length
    );
    console.log(`(参考) 最終更新は ${Math.round(hours)}時間前`);
  }

  // (13) 画像の付与状況（無い＝カードが灰色になる。率で見張る）
  {
    const noImg = shown.filter((r) => !r.imageUrl);
    const badUrl = shown.filter((r) => r.imageUrl && !/^https?:\/\//.test(r.imageUrl));
    report("image_bad_url", "画像URLが不正", "error", badUrl.map((r) => `#${r.id} ${r.imageUrl}`), baseline);
    const rate = shown.length ? noImg.length / shown.length : 0;
    report(
      "image_missing_rate",
      `画像が無い割合が高い（${Math.round(rate * 100)}%）`,
      "warn",
      rate > 0.4 ? [`${noImg.length}/${shown.length}件に画像が無い`] : [],
      baseline
    );
    console.log(`(参考) 画像なし ${noImg.length}/${shown.length}件（${Math.round(rate * 100)}%）`);
  }

  // (14) ページ件数の急変（基準値比。ページが空になった・半減したのは事故）
  {
    const bad: string[] = [];
    for (const p of pages) {
      const prev = baseline.pages?.[p.name];
      if (prev == null || prev < 10) continue;
      if (p.rows.length === 0) bad.push(`${p.name} が0件（基準${prev}件）`);
      else if (p.rows.length < prev * 0.5) bad.push(`${p.name} が急減 ${prev}→${p.rows.length}件`);
    }
    report("page_count_drop", "ページの掲載件数が急減した", "error", bad, baseline);
  }

  // (14b) **説明のつかない掲載減**。件数の割合ではなく、消えた行を1件ずつ理由に分ける。
  //
  // 経緯: ここは元々「基準値から2割以上減ったら WARN」という閾値だった。それが本日
  // `/genre/スニーカー` 25→18件（-28%）で ERROR を出したが、中身は **8/7・8/8 発売の
  // スニーカー10件が今日になって過去日になっただけ**＝暦が進んだ結果で、何も壊れていない。
  // スニーカーは発売日当日に消える商品なので、この面では毎日鳴り続ける誤報になる。
  //
  // かといって閾値を緩めると、この検査が生まれた事件（自分のコード変更で /premium を
  // 63→36件に削ったのに素通りした）を取り逃がす。**要るのは閾値の調整ではなく、
  // 「暦のせいで減った分」と「説明のつかない減り方」を分けること**（src/lib/pageLoss.ts）。
  //
  // 参照点は **直前の実行**（audit-profile.json）。この検査が見たいのは収集元の日々の変化
  // ではなく **自分のコード変更が表示範囲を削っていないか** なので、同じデータに対する
  // 前後比較でしか出ない（[[System/rules]]「参照点も分ける」）。
  {
    const inDb = new Map(all.map((r) => [r.id, r]));
    const bad: string[] = [];
    let comparedPages = 0;
    const explained: string[] = [];
    for (const p of pages) {
      const prevIds = prevPageIds.ids[p.name];
      if (!prevIds || prevIds.length < 10) continue;
      comparedPages++;
      const nowIds = new Set(p.rows.map((r) => r.id));
      const removed = prevIds
        .filter((id) => !nowIds.has(id))
        .map((id) => ({ id, inDb: inDb.has(id), eventDate: inDb.get(id)?.eventDate ?? null }));
      if (!removed.length) continue;
      const loss = classifyPageLoss(p.name, removed, today);
      const n = isReportableLoss(prevIds.length, p.rows.length, loss.unexplained.length);
      if (n > 0) {
        bad.push(
          `${p.name} が ${prevIds.length}→${p.rows.length}件。うち **説明のつかない消失 ${loss.unexplained.length}件**` +
            `（日付切れ ${loss.expired} / 収集元から消えた ${loss.gone}）例: ${loss.unexplained
              .slice(0, 5)
              .map((id) => `#${id}`)
              .join(" ")}`
        );
      } else if (loss.expired || loss.gone || loss.unexplained.length) {
        explained.push(
          `${p.name}: -${removed.length}（日付切れ ${loss.expired} / 収集元から消えた ${loss.gone} / 説明なし ${loss.unexplained.length}）`
        );
      }
    }
    report("page_rows_unexplained_loss", "掲載が減ったが、暦でも収集元でも説明がつかない", "warn", bad, baseline, comparedPages);
    console.log(
      `(参考) 掲載減の内訳（直前の実行 ${prevPageIds.runAt ?? "記録なし"} と比較・${comparedPages}ページ）: ` +
        (explained.length ? explained.join("  /  ") : "減少なし")
    );
    // 比較対象そのものが無い状態（初回・audit-profile.json を消した後）は、母数0＝この検査が
    // 何も守っていないので下の check_idle で落ちる。それ自体は正しいが、原因が分からないと
    // 「監査が壊れた」に見えるので、直し方をその場で書く。
    if (comparedPages === 0)
      console.log(
        "         ↑ 比較する記録がありません（初回、または audit-profile.json を消した後）。" +
          "もう一度 `npm run audit` を回すと、この検査は次回から有効になります。"
      );
  }

  // (15) リンク到達性（--links のときだけ。各ソース2件を抜き取り）
  //
  // ※ HEAD を使ってはいけない。snkrdunk は **HEAD に 404、GET に 200** を返すため、
  //   HEAD で判定した初回実行は生きているリンクを「404」と誤報した（実測）。
  //   誤報する検査は本物を埋もれさせるので、実際のユーザーと同じ GET で確かめ、
  //   さらに1回再試行して一時的な失敗と区別する。本文は読まずに捨てる。
  if (CHECK_LINKS) {
    const UA = "Mozilla/5.0 (compatible; SedoriRadar/1.0)";
    const status = async (url: string): Promise<number | null> => {
      try {
        const res = await fetch(url, {
          method: "GET",
          redirect: "follow",
          headers: { "User-Agent": UA },
          signal: AbortSignal.timeout(12000),
        });
        res.body?.cancel();
        return res.status;
      } catch {
        return null; // ネットワーク側の一時失敗は判定しない
      }
    };
    const bySource = new Map<string, Row[]>();
    for (const r of shown) (bySource.get(r.source) ?? bySource.set(r.source, []).get(r.source)!).push(r);
    const targets: Row[] = [];
    for (const arr of bySource.values()) targets.push(...arr.slice(0, 2));
    const bad: string[] = [];
    await Promise.all(
      targets.map(async (r) => {
        const first = await status(r.url);
        if (first === null || first < 400) return;
        const second = await status(r.url); // 一時的な失敗と区別するための再確認
        if (second !== null && second >= 400) bad.push(`[${r.source} #${r.id}] HTTP ${second} ${r.url}`);
      })
    );
    report("link_dead", "リンク先が404等を返している（抜き取り）", "warn", bad, baseline);
    console.log(`(参考) リンク到達性: ${targets.length}件を抜き取り検査（GET・失敗は再確認）`);
  }

  // (16) **買いに行けない商品**（行き止まり）。
  //
  // 2026-08-10 の実地検証（自分でせどらーとして仕入れようとした）で最初に詰まった型。
  // プレミアムバンダイの250件は、収集元を非公開にした際に item.url を出さなくなった一方で、
  // 収集元の記事が持っていた **p-bandai の商品URLを拾っていなかった**ため、詳細ページに
  // 「駿河屋で見る（＝売り先）」と「楽天で探す（＝検索窓）」しか無く、**予約しに行けなかった**。
  //
  // 掲載の目的は「いつ買えるか」を伝えることなので、**どこで買えるかが1本も無い行は機能不全**。
  // 判定は詳細ページのボタン生成と同じ条件（src/lib/outbound.ts）で行う＝画面に出る事実を見る。
  {
    // 「開催店舗」を持つコラボ/ポップアップは行き止まりではない（会場限定なので、
    // 通販リンクではなく**行く場所**が導線）。stores を導線として数える。
    const deadEnd = shown.filter(
      (r) =>
        !isOfficialUrl(r.source) &&
        !r.officialUrl &&
        !hasSearchableTitle(r.source) &&
        !parseStoresJson(r.stores)
    );
    const rate = shown.length ? deadEnd.length / shown.length : 0;
    report(
      "no_purchase_route",
      `購入導線が1本も無い商品がある（${Math.round(rate * 100)}%）`,
      "warn",
      deadEnd.slice(0, 10).map((r) => `[${r.source} #${r.id}] ${r.title.slice(0, 40)}`),
      baseline,
      shown.length
    );
    // ソース単位でも見る。1ソース丸ごと導線を失う（＝今回のプレバンの型）を、全体の率では
    // 薄まって見逃すため。表示20件以上のソースで「公式URLを持つ率0%」なら鳴らす。
    const bySrc = new Map<string, { n: number; withOfficial: number }>();
    for (const r of shown) {
      const e = bySrc.get(r.source) ?? { n: 0, withOfficial: 0 };
      e.n++;
      if (isOfficialUrl(r.source) || r.officialUrl || parseStoresJson(r.stores)) e.withOfficial++;
      bySrc.set(r.source, e);
    }
    const lostRoute: string[] = [];
    for (const [src, e] of bySrc) {
      if (e.n < 20) continue;
      const prev = baseline.metrics?.[`official_rate:${src}`];
      const now = e.withOfficial / e.n;
      metrics[`official_rate:${src}`] = Math.round(now * 100) / 100;
      if (prev != null && prev >= 0.5 && now < prev * 0.5)
        lostRoute.push(`${src}: 公式リンクを持つ率 ${Math.round(prev * 100)}%→${Math.round(now * 100)}%（${e.withOfficial}/${e.n}件）`);
    }
    report("official_route_lost", "ソース単位で公式リンクが失われた", "error", lostRoute, baseline, bySrc.size);
  }

  // (17) **仕組みそのものの検査**（データではなく、更新を回している足回りを見る）。
  //
  // 2026-08-10 に判明した2件は、どちらも「データを見ていれば分かる」類ではなかった:
  //  ・run_scrape.bat が日本語の rem 行で壊れていた。cmd.exe は .bat をバイト位置で読み直す
  //    ため、マルチバイト文字があると解析位置がずれ、コメントの途中からコマンドとして走る。
  //    起動即死するので**ログが1行も残らず**、失敗にすら見えなかった。
  //  ・列追加が手作業SQLで、ローカルと本番のスキーマがズレても誰も気付けなかった。
  // どちらも機械で1行チェックできるので、毎回見る。
  {
    const bad: string[] = [];
    const batPath = path.join(process.cwd(), "run_scrape.bat");
    try {
      const buf = fs.readFileSync(batPath);
      const nonAscii = [...buf].filter((b) => b > 0x7f).length;
      if (nonAscii > 0)
        bad.push(
          `run_scrape.bat に非ASCIIバイトが ${nonAscii}個ある。cmd.exe の解析位置がずれて起動即死する（実測 2026-08-10）。日本語の説明は run_scrape.md に書くこと`
        );
    } catch {
      bad.push("run_scrape.bat が見つからない（定例更新の入口が消えている）");
    }
    report("runner_bat_not_ascii", "定例更新の bat が壊れる書き方になっている", "error", bad, baseline, 1);
  }
  {
    // schema.prisma の Item の列が、いま繋がっているDBに全部あるか（＝適用漏れ）。
    const declared = [
      ...fs
        .readFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), "utf8")
        .split("model Item {")[1]
        .split("\n}")[0]
        .matchAll(/^\s{2}(\w+)\s+\S/gm),
    ].map((m) => m[1]);
    const info = (await prisma.$queryRawUnsafe(`PRAGMA table_info("Item")`)) as { name: string }[];
    const actual = new Set(info.map((r) => r.name));
    const missing = declared.filter((c) => !actual.has(c));
    report(
      "schema_drift",
      "schema.prisma にある列がDBに無い（マイグレーション適用漏れ）",
      "error",
      missing.map((c) => `Item.${c} がDBに無い。\`npm run db:alter\` を流すこと`),
      baseline,
      declared.length
    );
  }

  // ── 未知の型のための観測（判定はしない。差分と標本を出して人間が読む） ──
  // 不変条件は「私が過去に見た型」しか捕まえられない。ここは型を定義せずに
  // 「前回と違うところ」と「生の標本」を毎回出す枠。判定しないので ERROR にはしない。
  // ── 検査自身の検査: 「見た上での0」か「何も見ていない0」かを区別する ──────────
  //
  // 検査は本番を壊さないので、対象が消えて空振りになっても誰も気付かない。実測でこれが起きた:
  // 実況タイトルの検査4種は対象が channeltono/rarecheck/x_watch 固定だったので、掲載基準を
  // 変えてこの3ソースが 303→27件 になった瞬間、「きれいだから0」ではなく
  // 「ほとんど見ていないから0」に変わっていた。件数は同じ0なので出力からは区別できない。
  // → 検査ごとの母数を記録し、**0になった／半分以下に減った**ものを落とす。
  {
    const declared = Object.keys(coverage);
    const lost: string[] = [];
    const shrunk: string[] = [];
    for (const key of declared) {
      const now = coverage[key];
      const prev = baseline.coverage?.[key];
      if (now === 0 && (prev ?? 0) > 0) lost.push(`${key}: 母数 ${prev} → 0件（検査が空振りしている）`);
      else if (prev != null && prev >= 20 && now < prev * 0.5)
        shrunk.push(`${key}: 母数 ${prev} → ${now}件（${Math.round((now / prev - 1) * 100)}%）`);
    }
    report("check_coverage_lost", "検査の母数が0になった（空振りしている）", "error", lost, baseline);
    report("check_coverage_shrunk", "検査の母数が半分以下に減った", "warn", shrunk, baseline);
    // 母数0の検査は「検査を持っている」だけで、実際には何も守っていない。
    // 前回との比較（上）とは別に、**今この瞬間に空振りしているもの**を毎回名指しする。
    // ラチェットで件数を固定するので、新しく空振りが増えたら ERROR になる。
    const idle = declared.filter((k) => coverage[k] === 0).map((k) => `${k}: 母数0（この検査は今なにも守っていない）`);
    report("check_idle", "母数0の検査がある（持っているだけで機能していない）", "warn", idle, baseline);
    for (const key of declared) metrics[`coverage:${key}`] = coverage[key];
    console.log(
      `(参考) 母数を申告している検査 ${declared.length}種: ` +
        declared.map((k) => `${k}=${coverage[k]}`).join("  ")
    );
  }

  runDrift(
    shown,
    today,
    UPDATE_BASELINE,
    Object.fromEntries(pages.map((p) => [p.name, p.rows.length])),
    Object.fromEntries(pages.map((p) => [p.name, p.rows.map((r) => r.id)])),
    dataFingerprint
  );

  // ── 出力 ──
  const errors = findings.filter((f) => f.level === "error");
  const warns = findings.filter((f) => f.level === "warn");
  for (const f of [...errors, ...warns]) {
    const ratchet = f.baseline !== null ? `（前回 ${f.baseline}件 → 今回 ${f.items.length}件）` : "";
    console.log(`\n【${f.level === "error" ? "❌ERROR" : "⚠️WARN"}】${f.title}: ${f.items.length}件${ratchet}`);
    for (const s of f.items.slice(0, 8)) console.log(`   - ${s}`);
    if (f.items.length > 8) console.log(`   … 他 ${f.items.length - 8}件`);
  }

  // 減った分は baseline を締める（ラチェット）。増えた分は ERROR なので通らない。
  //
  // ただし「増えたが、中身を確認したら正当だった」場合の逃げ道が要る。無いと、
  // 正しいデータが増えただけで永久に ERROR が居座り、いずれ誰も見なくなる（＝WARN放置の再来）。
  // その場合だけ `--accept` を明示して受け入れる。**中身を1件ずつ見た後にだけ使うこと。**
  const ACCEPT = args.includes("--accept");
  const nextChecks: Record<string, number> = { ...(baseline.checks ?? {}) };
  for (const [k, v] of Object.entries(counts)) {
    if (nextChecks[k] == null || v < nextChecks[k] || ACCEPT) nextChecks[k] = v;
  }
  // ページ件数の基準は「**最後に受け入れた状態**」であって過去最大ではない。
  //
  // 以前は Math.max で過去最大を保持していたが、掲載件数は指摘件数と違って自然に増減する
  // （月ページは日が進めば縮む／ソースの記事が入れ替わる）。過去最大と比べ続けると、
  // 一度ピークを打ったページは **--update-baseline を回しても下がらず、警告が永久に居座る**
  // （実測: /genre/フィギュア がピーク330に対し実際218件で、-34%が毎回鳴り続ける状態だった）。
  // 消せない警告は誤報と同じで、いずれ誰も読まなくなる。
  // 「受け入れて隠す」危険は、判定しない観測（drift のページ別差分＝直前の実行との比較）が
  // コード変更由来の減少をその場で出すことで別に担保する。
  const nextPages: Record<string, number> = { ...(baseline.pages ?? {}) };
  for (const p of pages) nextPages[p.name] = p.rows.length;

  if (UPDATE_BASELINE) {
    fs.writeFileSync(
      BASELINE_PATH,
      JSON.stringify(
        {
          // ※ 既存キーを残す。このファイルは audit.ts だけの持ち物ではなく、
          //   audit:facts もラチェット（facts.checked / facts.findings）を置く。
          //   丸ごと組み立て直すと、もう一方の基準を黙って消してしまう。
          ...baseline,
          updatedAt: new Date().toISOString(),
          checks: nextChecks,
          pages: nextPages,
          metrics: { ...(baseline.metrics ?? {}), ...metrics },
          coverage: { ...(baseline.coverage ?? {}), ...coverage },
        },
        null,
        2
      ) + "\n"
    );
    console.log(`\nbaseline を更新: ${BASELINE_PATH}`);
  } else {
    const loosened = Object.entries(counts).filter(([k, v]) => (baseline.checks?.[k] ?? Infinity) > v);
    if (loosened.length)
      console.log(`\n(参考) 改善した検査が ${loosened.length}種あります。\`npm run audit -- --update-baseline\` で上限を締められます。`);
  }

  console.log(`\n==== 監査結果: ERROR ${errors.length}種 / WARN ${warns.length}種 ====`);
  await prisma.$disconnect();
  if (errors.length) process.exitCode = 1;
}

main();
