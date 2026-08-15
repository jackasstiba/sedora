import { prisma } from "./prisma";
import { todayJst } from "./date";
import { dedupeItems, sortByEventDate } from "./itemFilter";

// トレカを「タイトル別」（ポケカ / ワンピースカード / 遊戯王 …）に束ねるための定義。
// DBにタイトル列は無く、データが源ごとに分散している（pokemoncard=ポケカ、
// torecamapはsubGenreにゲーム名、channelttonoはフリーテキスト）ため、
// source / subGenre / title の複合で判定する。
// 競合(tcgprice/toreca-souba)はタイトル別ページでSEO流入を取っているため、
// ハツコレも同じ土俵に乗せるのが狙い。

type TcgRow = { title: string; subGenre: string | null; source: string };

function hit(re: RegExp, ...vals: (string | null | undefined)[]): boolean {
  return vals.some((v) => !!v && re.test(v));
}

export const TCG_TITLES: { label: string; match: (i: TcgRow) => boolean }[] = [
  {
    label: "ポケカ",
    match: (i) =>
      i.source === "pokemoncard" ||
      hit(/ポケモン|ポケカ/, i.subGenre) ||
      hit(/ポケモンカード|ポケカ/, i.title),
  },
  {
    label: "ワンピースカード",
    match: (i) =>
      hit(/ワンピース\s?カード|ワンピカ|ONE\s?PIECE\s?カード/i, i.title) ||
      hit(/ワンピース|ONE\s?PIECE/i, i.subGenre),
  },
  {
    label: "ガンダムカード",
    match: (i) =>
      hit(/ガンダムカード|GUNDAM\s?CARD/i, i.title) || hit(/ガンダム/, i.subGenre),
  },
  {
    label: "遊戯王",
    match: (i) => hit(/遊戯王|遊☆戯☆王/, i.title) || hit(/遊戯王/, i.subGenre),
  },
  {
    label: "ドラゴンボールカード",
    match: (i) => hit(/ドラゴンボール|フュージョンワールド|FUSION\s?WORLD/i, i.title),
  },
  {
    label: "デュエマ",
    match: (i) =>
      hit(/デュエル・?マスターズ|デュエマ|\bDM\d/i, i.title) || hit(/デュエ/, i.subGenre),
  },
  {
    label: "ヴァイスシュヴァルツ",
    match: (i) => hit(/ヴァイスシュヴァルツ|ヴァイス/, i.title) || hit(/ヴァイス/, i.subGenre),
  },
  {
    label: "MTG",
    match: (i) =>
      hit(/マジック[:：]?ザ・?ギャザリング|\bMTG\b/i, i.title) || hit(/MTG|マジック/i, i.subGenre),
  },
  {
    label: "名探偵コナンカード",
    match: (i) =>
      hit(/名探偵コナン|コナンカード|追憶の盟友/, i.title) || hit(/コナン/, i.subGenre),
  },
  {
    label: "デジモンカード",
    match: (i) => hit(/デジモンカード|デジモン/, i.title) || hit(/デジモン/, i.subGenre),
  },
];

export function isTcgTitle(label: string): boolean {
  return TCG_TITLES.some((t) => t.label === label);
}

/** これから予約・発売の「トレカ」を全件取り、メモリ上でタイトル判定する
 *  （トレカgenreは件数が少ないため全件フェッチで十分・分類はDB列に無いのでJS側）。 */
async function upcomingTcgRows() {
  const today = todayJst();
  const rows = await prisma.item.findMany({
    where: { genre: "トレカ", OR: [{ eventDate: { gte: today } }, { eventDate: null }] },
    orderBy: [{ eventDate: { sort: "asc", nulls: "last" } }, { id: "desc" }],
  });
  // 他の一覧と同じ整理を通す。以前は dedupeCrossSource だけを呼んでいたため、語順違い・
  // 同一ソース再投稿の重複と、商品として成立していない投稿がこのページにだけ残っていた。
  return sortByEventDate(dedupeItems(rows));
}

/** ナビ/サイトマップ用：現在アイテムを持つタイトルと件数（TCG_TITLESの並び順を保持） */
export async function getTcgTitleCounts(): Promise<{ label: string; count: number }[]> {
  const rows = await upcomingTcgRows();
  return TCG_TITLES.map((t) => ({
    label: t.label,
    count: rows.filter((r) => t.match(r)).length,
  })).filter((x) => x.count > 0);
}

/** タイトルページ用：そのTCGタイトルの、これから予約・発売のアイテム */
export async function getItemsByTcgTitle(label: string) {
  const def = TCG_TITLES.find((t) => t.label === label);
  if (!def) return [];
  const rows = await upcomingTcgRows();
  return rows.filter((r) => def.match(r));
}
