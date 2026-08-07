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
 *     `npm run audit -- --update-baseline`（減った時だけ自動で締まる）。
 *  3. **「無い・0である」も検査する。** 値が変なものだけでなく、あるべきデータが消えたこと
 *     （ソースが更新されない／相場の付与が0件になる）も落とす。機能は静かに死ぬ。
 *
 * 新しい粗の型に気づいたら invariant をここに足す＝「全方位」を言葉でなく実装で担保する。
 */
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/prisma";
import { displayEventDateText, todayJst } from "../src/lib/date";
import { cleanListTitle } from "../src/lib/title";
import { dedupeKey, GENRE_ORDER } from "../src/lib/itemFilter";
import { parseYen } from "../src/lib/margin";
import { parsePrizesJson } from "../src/lib/prizes";
import { loadDisplayedPages, type DisplayedPage } from "../src/lib/pages";
import { runDrift } from "./auditDrift";

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

/** 検査結果を記録する。level="warn" でも baseline を超えたら ERROR に昇格する。 */
function report(key: string, title: string, level: Level, items: string[], baseline: Baseline) {
  counts[key] = items.length;
  const base = baseline.checks?.[key] ?? null;
  if (!items.length) return;
  const exceeded = base !== null && items.length > base;
  findings.push({ key, title, level: exceeded ? "error" : level, items, baseline: base });
}

type Baseline = { updatedAt?: string; checks?: Record<string, number>; pages?: Record<string, number> };
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

async function main() {
  const baseline = loadBaseline();
  const today = todayJst();
  const curYear = today.getUTCFullYear();

  const pages = await loadDisplayedPages();
  // 全ページの和集合＝「サイトが今見せている全件」。個別の検査はこれに対して回す。
  const byId = new Map<number, Row>();
  for (const p of pages) for (const r of p.rows) byId.set(r.id, r);
  const shown = [...byId.values()];
  const all = await prisma.item.findMany({ take: 100000 });

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
  for (const { key, re } of NOISE_CHECKS) {
    const bad: string[] = [];
    for (const r of shown) {
      if (!MIRROR_SOURCES.has(r.source)) continue;
      const c = cleanListTitle(r.source, r.title);
      if (re.test(c)) bad.push(`[${r.source} #${r.id}] ${c}`);
    }
    report(`title_noise:${key}`, `タイトルに実況が残る（${key}）`, "error", bad, baseline);
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
      const isSinglePack = /(?:ブースター|スターター)?パック/.test(t) && !isBoxWord;
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
      const hits = [...r.title.matchAll(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/g)]
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
    report("prizes_broken", "一番くじの各賞データが壊れている", "error", broken, baseline);
    report("prizes_resale_suspect", "各賞の二次相場が疑わしい", "error", suspect, baseline);
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
    report("prizes_resale_missing", "各賞の二次相場が1件も付かない（機能が死んでいる疑い）", "error", dead, baseline);
    console.log(
      `(参考) 一番くじ各賞: ${prizeItems}件 / ${prizeRows}賞 / 二次相場 ${resaleRows}件` +
        `（発売から14日以上 ${ripeKuji.length}件・うち相場付き ${ripeWithResale.length}件）`
    );
  }

  // (11) 受付中ストア（stores JSON）の構造
  {
    const bad: string[] = [];
    for (const r of all) {
      if (!r.stores) continue;
      try {
        const arr = JSON.parse(r.stores);
        if (!Array.isArray(arr) || !arr.length) {
          bad.push(`#${r.id} stores が空`);
          continue;
        }
        for (const s of arr) {
          if (!s?.name || !s?.url) bad.push(`#${r.id} ストアの name/url 欠落`);
          else if (!/^https?:\/\//.test(s.url)) bad.push(`#${r.id} 不正なストアURL ${s.url}`);
        }
      } catch {
        bad.push(`#${r.id} stores の JSON が壊れている`);
      }
    }
    report("stores_broken", "受付中ストアのデータが壊れている", "error", bad, baseline);

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
    const BY_DESIGN: Record<string, string> = {
      figisland_pb: "差分取得（価格まで取得済みは再取得しない）ため0件が正常",
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

  // (14) ページ件数の急変（前回比。ページが空になった・半減したのは事故）
  {
    const bad: string[] = [];
    for (const p of pages) {
      const prev = baseline.pages?.[p.name];
      if (prev == null || prev < 10) continue;
      if (p.rows.length === 0) bad.push(`${p.name} が0件（前回${prev}件）`);
      else if (p.rows.length < prev * 0.5) bad.push(`${p.name} が急減 ${prev}→${p.rows.length}件`);
    }
    report("page_count_drop", "ページの掲載件数が急減した", "error", bad, baseline);
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

  // ── 未知の型のための観測（判定はしない。差分と標本を出して人間が読む） ──
  // 不変条件は「私が過去に見た型」しか捕まえられない。ここは型を定義せずに
  // 「前回と違うところ」と「生の標本」を毎回出す枠。判定しないので ERROR にはしない。
  runDrift(shown, today, UPDATE_BASELINE);

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
  const nextChecks: Record<string, number> = { ...(baseline.checks ?? {}) };
  for (const [k, v] of Object.entries(counts)) {
    if (nextChecks[k] == null || v < nextChecks[k]) nextChecks[k] = v;
  }
  const nextPages: Record<string, number> = { ...(baseline.pages ?? {}) };
  for (const p of pages) nextPages[p.name] = Math.max(nextPages[p.name] ?? 0, p.rows.length);

  if (UPDATE_BASELINE) {
    fs.writeFileSync(
      BASELINE_PATH,
      JSON.stringify({ updatedAt: new Date().toISOString(), checks: nextChecks, pages: nextPages }, null, 2) + "\n"
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
