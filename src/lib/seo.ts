import { prisma } from "./prisma";
import { todayJst } from "./date";
import { dedupeItems, dedupeKey, GENRE_ORDER } from "./itemFilter";
import { computeMargin } from "./margin";
import { franchiseAliases, franchiseLabel } from "./franchise";

// SEO向けの個別ページ（商品/ジャンル/月）で使うデータ取得・整形ヘルパー。

// ジャンルの語彙・表示順は itemFilter.ts に集約（監査が同じ定義で語彙を検査するため）。

export type SeoItem = Awaited<ReturnType<typeof getItemById>>;

export async function getItemById(id: number) {
  if (!Number.isFinite(id)) return null;
  return prisma.item.findUnique({ where: { id } });
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
  return dedupeItems(rows);
}

/** プレ値/相場ビュー用：相場（marketPriceText）が付いたアイテムを、**発売済み（過去）も
 *  含めて**取得し、定価比（プレ値率）の高い順に返す。
 *
 *  背景: 通常の一覧は「今後の予定＋日付未定」しか出さないため、発売済みで高騰した品や
 *  X巡回で付けた実売相場（メルカリ○万）が一覧から消え、詳細ページでしか見えなかった。
 *  この構造ミスマッチを解消し、「発売済みでも高プレ値なら見せる」専用ビューを提供する。
 *
 *  並び: **相場額（marketPrice）の高い順**を主キーにする。X由来の高額実売
 *  （メルカリ SP ¥150,000 等＝せどりの本命）は定価不明で定価比が出ないため、率順を
 *  主キーにすると価値の低いマイナス%の中古より下に沈む。額順なら本命が上に来る。
 *  同額なら定価比（プレ値率）の高い順。一覧・関連と同じ dedupeItems で重複を畳む。 */
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
  return dedupeItems(rows).slice(0, take);
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

/** 月ページ用：その月に発売・開催のアイテム（過去も含めた一覧） */
export async function getItemsByMonth(month: string, take = 300) {
  const range = monthRange(month);
  if (!range) return [];
  // 月ページも他の一覧と同じ整理（重複解消・非商品投稿の除外）を通す。ここだけ dedupeItems を
  // 呼んでいなかったため、同じ商品が2枚並ぶ・実況投稿が載るのが月ページだけ起きていた。
  return dedupeItems(
    await prisma.item.findMany({
      where: { eventDate: { gte: range.start, lt: range.end } },
      orderBy: [{ eventDate: "asc" }, { id: "desc" }],
      take,
    })
  );
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
    select: { eventDate: true },
  });
  const now = todayJst();
  const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const set = new Set<string>();
  for (const r of rows) {
    if (!r.eventDate) continue;
    const d = new Date(r.eventDate);
    const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    if (month < currentMonth) continue; // 過去月は除外（当月は途中でも残す）
    set.add(month);
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
  return prisma.item.findMany({
    where: { OR: [{ eventDate: { gte: grace } }, { eventDate: null }] },
    select: { id: true, scrapedAt: true },
  });
}
