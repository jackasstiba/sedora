import { prisma } from "./prisma";
import { todayJst } from "./date";
import {
  dedupeItems,
  dedupeKey,
  GENRE_ORDER,
  itemPeriodMs,
  MAX_PERIOD_DAYS,
  overlapsRange,
  sortByEventDate,
  withLiveStoreDeadline,
} from "./itemFilter";
import { computeMargin } from "./margin";
import { franchiseAliases, franchiseLabel } from "./franchise";

// SEO向けの個別ページ（商品/ジャンル/月）で使うデータ取得・整形ヘルパー。

// ジャンルの語彙・表示順は itemFilter.ts に集約（監査が同じ定義で語彙を検査するため）。

export type SeoItem = Awaited<ReturnType<typeof getItemById>>;

export async function getItemById(id: number) {
  if (!Number.isFinite(id)) return null;
  const row = await prisma.item.findUnique({ where: { id } });
  // 応募先を持つ商品の「抽選日」は、一覧と同じく today から作り直す。DBの eventDate は
  // 最後の締切（＝載せ続けてよい期限）なので、そのまま出すと一覧と日付が食い違う。
  return row ? withLiveStoreDeadline(row) : null;
}

/**
 * 関連アイテムを2系統で返す（自分自身は除く）。
 * - series: タイトルから作品を判定し、同じ作品の予約/発売（ジャンル横断）。関連性が高い。
 * - genre:  同ジャンルの新着（作品で拾えない/枠が余った分の補完）。series と重複しない。
 */
export async function getRelatedItems(
  item: { id: number; genre: string; title: string },
  take = 12
) {
  const today = todayJst();
  const upcoming = { OR: [{ eventDate: { gte: today } }, { eventDate: null }] };
  const orderBy = [
    { eventDate: { sort: "asc" as const, nulls: "last" as const } },
    { id: "desc" as const },
  ];

  // 1) 同じ作品（ジャンル横断）。ワンピのフィギュアとカードを互いに関連づける等。
  //    figisland↔koretore が同じプライズを両方載せるため、一覧と同じ dedupeItems で
  //    クロスソース重複を畳む（畳まないと関連欄に同一フィギュアが2枚並ぶ）。
  const aliases = franchiseAliases(item.title);
  const rawSeries = aliases.length
    ? await prisma.item.findMany({
        where: {
          id: { not: item.id },
          AND: [{ OR: aliases.map((a) => ({ title: { contains: a } })) }, upcoming],
        },
        orderBy,
        take: take + 8, // dedupe で減る分を見込んで多めに取る
      })
    : [];
  const series = dedupeItems(rawSeries).slice(0, take);

  // 2) 同ジャンルで補完（series と自分自身は除外）。series と同じ商品（別ソース含む）が
  //    genre 側に再登場して2セクションで重複しないよう、series のタイトルキーでも除外する。
  const seriesKeys = new Set(
    series.map((s) => dedupeKey(s.title)).filter((k) => k.length >= 6)
  );
  const excludeIds = [item.id, ...series.map((s) => s.id)];
  const need = take - series.length;
  const genre =
    need > 0
      ? dedupeItems(
          await prisma.item.findMany({
            where: { genre: item.genre, id: { notIn: excludeIds }, ...upcoming },
            orderBy,
            take: need + 8,
          })
        )
          .filter((g) => {
            const k = dedupeKey(g.title);
            return k.length < 6 || !seriesKeys.has(k);
          })
          .slice(0, need)
      : [];

  return { seriesLabel: franchiseLabel(item.title), series, genre };
}

/** ジャンルページ用：今後の予定＋日付未定を発売日順で。
 *  take はジャンル最大件数（フィギュアは400件超）を賄えるだけ確保する。
 *  以前は 200 で頭打ちになり、フィギュアで約200件が欠落し見出しの件数も過少だった。 */
export async function getItemsByGenre(genre: string, take = 1500) {
  const today = todayJst();
  const rows = await prisma.item.findMany({
    where: { genre, OR: [{ eventDate: { gte: today } }, { eventDate: null }] },
    orderBy: [{ eventDate: { sort: "asc", nulls: "last" } }, { id: "desc" }],
    take,
  });
  // ジャンルページの一覧・見出し件数（items.length）から重複を除く。
  // 応募先を持つ商品は表示日が today 基準に作り直されるので、並べ直してから返す。
  return sortByEventDate(dedupeItems(rows));
}

/**
 * 【保留中】プレ値/相場ビュー（`/premium`）用の取得。**2026-08-10 に表示を取り下げた。**
 *
 * 取り下げた理由: 相場の出どころが駿河屋（＝1店舗の言い値・在庫1点）で、現実の相場が
 * 決まるメルカリと食い違っていた。実測で「相場¥3,900・定価比+87%」と出ていた商品は、
 * 他店31店が¥2,980〜、駿河屋買取は¥2,200で、手数料と送料を引くと**利益ゼロ**だった。
 * さらに未発売の再販品に旧版の中古相場が付く／シリーズ番号(①②)を識別できない等、
 * 「別商品の値段」を相場として断定する構造的な誤りがあった。
 *
 * 併せて、発売前情報のサイトに「現在の中古相場」は本質的に噛み合わない（発売前の商品に
 * 中古相場は存在しないので、必ず“発売済み高騰品ランキング”になる＝相場専門サイトと同じ
 * 土俵になる）という論点も出た。復活させるなら「前作がいくらになったか」という実績側に
 * 作り替える。
 *
 * この関数と相場の収集(scripts/scrapePrices.ts)・DB列は**消さずに残す**（保留であって
 * 破棄ではない）。ただし表示面（`/premium`・カード・詳細・ヘッダー導線）からは外してある。
 */
export async function getPremiumItems(take = 200) {
  const rows = await prisma.item.findMany({
    where: { marketPriceText: { not: null } },
    orderBy: { id: "desc" },
    take: 1000,
  });
  // タイトル一致の重複解消(dedupeItems)に加え、駿河屋の**同一商品URL**に複数のDB商品
  // (torecamap/torecasoku 等が表記違いで別レコード)が紐づくケースを畳む。marketUrl は
  // 商品固有なので同URL＝同一商品＝同じ相場。X由来は marketUrl がアカウント共有なので除外。
  // 代表は「定価あり(=定価比が出せる)」を優先。
  const deduped = dedupeItems(rows);
  const surugayaRep = new Map<string, (typeof deduped)[number]>();
  const others: (typeof deduped)[number][] = [];
  for (const it of deduped) {
    if (it.marketSource === "x" || !it.marketUrl) {
      others.push(it);
      continue;
    }
    const prev = surugayaRep.get(it.marketUrl);
    if (!prev || (!prev.price && it.price)) surugayaRep.set(it.marketUrl, it);
  }
  return [...others, ...surugayaRep.values()]
    .map((it) => ({ it, m: computeMargin(it.price, it.marketPrice) }))
    .sort((a, b) => {
      const pa = a.it.marketPrice ?? 0;
      const pb = b.it.marketPrice ?? 0;
      if (pb !== pa) return pb - pa; // 相場額の高い順
      return (b.m?.pct ?? -Infinity) - (a.m?.pct ?? -Infinity); // 同額は定価比順
    })
    .slice(0, take)
    .map((x) => x.it);
}

/** 全ソース横断の「抽選」専用ビュー。せどりで最重要の“抽選で当てる”品を1画面に集約する。
 *  対象は getItems(status="lottery") と同じ意味論:
 *   ・eventType="抽選"（Nike SNKRS・家電/ゲーム機 nyuka_now）
 *   ・hasLottery=true（一番くじ・コラボ記事の抽選/ランダム賞品）
 *   ・タイトルに「抽選」を含む（snkrdunk の定型ラベル誤混入は除外）
 *  今後開催＋日付未定（受付中）だけを、締切/抽選日の近い順に出す。 */
export async function getLotteryItems(take = 300) {
  const today = todayJst();
  const rows = await prisma.item.findMany({
    where: {
      AND: [
        {
          OR: [
            { eventType: "抽選" },
            { hasLottery: true },
            { AND: [{ title: { contains: "抽選" } }, { source: { not: "snkrdunk" } }] },
          ],
        },
        { OR: [{ eventDate: { gte: today } }, { eventDate: null }] },
      ],
    },
    orderBy: [{ eventDate: { sort: "asc", nulls: "last" } }, { id: "desc" }],
    take: 1000,
  });
  return sortByEventDate(dedupeItems(rows)).slice(0, take);
}

/** "2026-08" -> その月の [開始, 翌月開始) */
function monthRange(month: string): { start: Date; end: Date } | null {
  const m = month.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  // 暦日は UTC 0時基準（保存値と揃える）
  return { start: new Date(Date.UTC(y, mo - 1, 1)), end: new Date(Date.UTC(y, mo, 1)) };
}

/**
 * 月ページ用：**その月に「応募できる日」があるアイテム**（過去も含めた一覧）。
 *
 * 2026-08-18 まで「eventDate がその月にある行」で絞っていたが、応募先(stores)を持つ行は
 * 1行が幅（受付開始〜最後の締切）を持つため、**9月ページに「8/16」と書かれたカード**が
 * 並んでいた（実測3件/628件）。eventDate は最後の締切、画面の日付は今日以降で最短の締切
 * ＝1点として扱う限りどちらの月に置いても嘘になる。
 *
 * → 所属を「**応募期間が月と重なるか**」で決める（[[Projects/sedori_radar]] の「本筋」）。
 *   月をまたぐ抽選は8月ページにも9月ページにも出る＝どちらの月に来た人からも見つかる。
 *   表示日だけで絞り直す案は採らない: それだと上の行が9月から消えたうえ、8月のSQL
 *   （eventDate が8月）にも入らず**どちらの月にも出ない穴**になる。
 */
export async function getItemsByMonth(month: string, take = 300) {
  const range = monthRange(month);
  if (!range) return [];
  // 締切が翌月にある抽選は eventDate（＝最後の締切）が翌月なので、その月のSQLには入らない。
  // 前もって見に行く範囲は応募期間の最大の幅（itemPeriodMs と同じ値）に合わせる。
  const lookahead = new Date(range.end.getTime() + MAX_PERIOD_DAYS * 86_400_000);
  // 2本に分けて取る。**その月に締切がある行の取得件数(take)は今までと同じに保つ**ため
  // （1本のクエリにまとめて take を増やすと、月ページに載る顔ぶれ自体が変わってしまい、
  //  この修正とは無関係な差分が出る）。2本目＝月をまたいで入ってくる行だけを足す。
  const [inMonthRows, spillRows] = await Promise.all([
    prisma.item.findMany({
      where: { eventDate: { gte: range.start, lt: range.end } },
      orderBy: [{ eventDate: "asc" }, { id: "desc" }],
      take,
    }),
    // 締切が翌月以降にずれ込む「応募期間がこの月から始まっている」行。stores を持つ行
    // だけが幅を持つので、広げる範囲はそこに限る（無関係な翌月分を引き込まない）。
    prisma.item.findMany({
      where: { eventDate: { gte: range.end, lt: lookahead }, stores: { not: null } },
      orderBy: [{ eventDate: "asc" }, { id: "desc" }],
      take: 200,
    }),
  ]);
  const rows = [...inMonthRows, ...spillRows];
  // 月ページも他の一覧と同じ整理（重複解消・非商品投稿の除外）を通す。ここだけ dedupeItems を
  // 呼んでいなかったため、同じ商品が2枚並ぶ・実況投稿が載るのが月ページだけ起きていた。
  // 期間の判定は**整理前の行**（＝DBの eventDate＝最後の締切）で行う。dedupeItems は表示日を
  // 「今日以降で最短の締切」に作り直すので、後から見ると期間の終端が分からなくなる。
  const inMonth = new Set(
    rows.filter((r) => overlapsRange(r, range.start, range.end)).map((r) => r.id)
  );
  return sortByEventDate(dedupeItems(rows.filter((r) => inMonth.has(r.id)))).slice(0, take);
}

export function isValidMonth(month: string): boolean {
  return monthRange(month) !== null;
}

/** "2026-08" -> "2026年8月" */
export function monthLabel(month: string): string {
  const m = month.match(/^(\d{4})-(\d{2})$/);
  if (!m) return month;
  return `${m[1]}年${Number(m[2])}月`;
}

/** サイトマップ／内部リンク用：アイテムを持つ月（yyyy-mm）の一覧を新しい順で。
 *  当月以降のみ返す。過去月の /release ページは期限切れ発売予定の“死にページ”で、
 *  サイトマップに載せるとクロール割当を薄め、内部リンクとしても価値がないため除外する
 *  （getSitemapItemRefs が過去アイテムを除外しているのと同じ方針で整合させる）。 */
export async function getMonthsWithItems(): Promise<string[]> {
  const rows = await prisma.item.findMany({
    where: { eventDate: { not: null } },
    // stores を持つ行は応募期間に**幅**があり、開始月と締切月が違うことがある
    // （getItemsByMonth と同じ基準で月を数えないと、中身はあるのにサイトマップと
    //  内部リンクから漏れる月が生まれる）。
    select: { eventDate: true, stores: true },
  });
  const now = todayJst();
  const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const monthOf = (ms: number) => {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  const set = new Set<string>();
  for (const r of rows) {
    if (!r.eventDate) continue;
    const period = itemPeriodMs(r);
    // 応募期間が触れる月を全部（開始月〜締切月）。幅を持たない行は1ヶ月だけになる。
    const months = new Set([monthOf(new Date(r.eventDate).getTime())]);
    if (period) {
      for (let t = period.start; t <= period.end; t += 86_400_000) months.add(monthOf(t));
      months.add(monthOf(period.end));
    }
    for (const month of months) {
      if (month < currentMonth) continue; // 過去月は除外（当月は途中でも残す）
      set.add(month);
    }
  }
  return [...set].sort().reverse();
}

/** 内部リンク用：ジャンル一覧（表示順を固定、未知ジャンルは末尾） */
export async function getGenreList(): Promise<string[]> {
  const rows = await prisma.item.groupBy({ by: ["genre"], _count: true });
  const genres = rows.map((r) => r.genre);
  return genres.sort((a, b) => {
    const ia = GENRE_ORDER.indexOf(a);
    const ib = GENRE_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
}

/** サイトマップ用：クロール価値のあるアイテムの id と更新日時。
 *  一覧に出る「今後の予定＋日付未定」に加え、直近に終了した分（60日）まで含める。
 *  ずっと過去の終了イベントは実質“死にページ”で、全件出すとクロール割当を薄め
 *  ランク付けを妨げるため除外する（サイトの表示スコープとも整合させる）。
 *  ※ 過去アイテムの個別ページ自体は 200 で残るので、除外しても 404 は生じない。 */
export async function getSitemapItemRefs() {
  const today = todayJst();
  const grace = new Date(today);
  grace.setUTCDate(grace.getUTCDate() - 60); // 直近60日で終了した分は残す
  const rows = await prisma.item.findMany({
    where: { OR: [{ eventDate: { gte: grace } }, { eventDate: null }] },
    select: {
      id: true,
      scrapedAt: true,
      source: true,
      title: true,
      genre: true,
      eventDate: true,
      eventDateText: true,
      url: true,
      // URLベースの重複突合（dedupeSameProductUrlCrossSource）は officialUrl も見る。
      // ここに無いと sitemap だけ畳まれず表示範囲とズレる（実測 2026-08-15: 5件の
      // 負け側が sitemap に残り sitemap_scope_drift が発火＝invariant が先に捕まえた）。
      officialUrl: true,
      price: true,
      imageUrl: true,
      // 「名前と日付しかないページ」を自分から申告しないための判定材料（hasSubstance）。
      highlights: true,
      prizes: true,
      stores: true,
      salesChannel: true,
      marketPriceText: true,
    },
  });
  // **掲載基準を通す**。ここが自前の where だけで完結していたため、サイトが「載せない」と
  // 決めた行まで Google に申告していた（実測 2026-08-10: 商品URL 2526件のうち **781件**が
  // 掲載基準で落ちる行＝日付なしのXミラー投稿 515件、クロスソース重複の負け側 229件ほか）。
  // 重複ページと実況投稿を自分から大量申告している状態で、クロール割当を薄める。
  // 表示範囲の定義は1か所（dedupeItems／src/lib/pages.ts）に揃える。
  // **中身の無いページは申告しない。** 名前と日付しか無いページは、収集元にも同じ情報が
  // あり、こちらに固有の中身が1つも無い＝Googleから見て重複に近い。0権威の新規ドメインで
  // そういうURLを混ぜると、クロール割当をそこに使わせて中身のあるページの発見を遅らせる。
  // （実測 2026-08-18: 2846件中46件＝1.6%。サイト内では従来どおり表示する＝落とすのは
  //  「自分からGoogleに申告する対象」だけで、内部リンクからは辿れる。）
  return dedupeItems(rows)
    .filter(hasSubstance)
    .map((r) => ({ id: r.id, scrapedAt: r.scrapedAt }));
}

/** そのページに「名前と日付」以外の固有の中身があるか。
 *
 *  sitemap の申告基準と、監査の薄いページ検査で**同じ定義**を使う（判定を二重に書かない）。
 *  相場(marketPriceText)は画面には出さないが（[[System/rules]] ハツコレの立ち位置）、
 *  ページの中身の有無としては数える。 */
export function hasSubstance(r: {
  imageUrl?: string | null;
  price?: string | null;
  marketPriceText?: string | null;
  highlights?: string | null;
  prizes?: string | null;
  stores?: string | null;
  salesChannel?: string | null;
  officialUrl?: string | null;
}): boolean {
  const has = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== "";
  return (
    has(r.imageUrl) || has(r.price) || has(r.marketPriceText) || has(r.highlights) ||
    has(r.prizes) || has(r.stores) || has(r.salesChannel) || has(r.officialUrl)
  );
}
