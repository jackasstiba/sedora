/**
 * 一覧のページ送りを書いてよい**唯一の場所**。
 *
 * なぜ1箇所に集めるのか（2026-08-18 に2度実害が出た型）:
 * スクレイパーごとに `const MAX_PAGES = 3` と書いて「実測3ページ。余裕を持たせて8」で
 * 止めていたが、**固定ページ数はいつか収集元に追い越される**。追い越されても件数もエラーも
 * 出ない（半分だけ取り込んだ「正常な巡回」に見える）ので、画面をいくら見ても分からない。
 *   - nyuka_now: 上限8ページ ← 収集元は17ページ・171記事 ＝ **90記事(53%)を一度も見ていなかった**
 *   - channeltono: 上限3ページ＝45記事 ← 投稿ペースは実測**25記事/日**（直近14日で355記事）
 *     ＝窓は**1.8日分**しかなく、巡回が1日空いた分から静かに落ちる
 *     （実測: 収集元の直近14日 355件のうち **40件が未取込**、うち29件は 8/04 の1日に集中）
 *
 * ここで決めた規約は3つ:
 *  1. **終端を見る**（新規が出なくなった / 404）。ページ数で止めない。
 *  2. 暦で流れる一覧（ブログ・速報）は**日付で足切り**する。「何ページ分」ではなく「何日分」。
 *  3. 上限に当たったのにまだ新規が出続けている＝窓が追い越された → **例外にする**。
 *     黙って半分だけ取り込むより、そのソースを赤くして前回値を保つ方が安全
 *     （巡回失敗時は upsert も受付終了の削除も走らないので既存データは壊れない。
 *      3日で audit の source_stale が ERROR を出す）。
 *
 * 新しいスクレイパーが自前のページ送りループを書けないように、`src/lib/crawlLint.ts` が
 * ソースを読んで検査する（audit の `crawl_discipline`）。**ドキュメントに書くだけでは守れなかった**
 * 実績があるため（rules.md に「固定ページ数を置かない」と書いた3日後に3ソースで見つかった）。
 */
import { fetchHtml, sleep } from "./util";

/** 1ページ分を読み終えた時点の状態。判断材料はこれだけ＝純関数で決められる。 */
export type CrawlStep = {
  /** 何ページ目か（1始まり） */
  page: number;
  /** そのページで**初めて見た**要素の数 */
  added: number;
  /** ページの末尾が足切り（cutoff）より古い＝以降のページは全部古い */
  reachedOld: boolean;
  /** 安全弁（終端の判定には使わない） */
  maxPages: number;
};

export type CrawlDecision = "continue" | "stop" | "overrun";

/**
 * 次のページへ進むか。**判定はここだけ**（selftest がこの関数を直接固定する）。
 *
 * 順序に意味がある: 「新規0」と「足切り」は*正常な終端*なので、上限に当たっていても
 * `overrun` にしない。上限で止まるのは「まだ新規が出続けている」ときだけ＝
 * **本当に窓が足りていない場合だけ赤くする**（暦が進むだけで鳴る検査にしない）。
 */
export function crawlDecision(s: CrawlStep): CrawlDecision {
  if (s.added === 0) return "stop"; // 終端＝これ以上新しいものは出てこない
  if (s.reachedOld) return "stop"; // 足切り＝以降は全部古い
  if (s.page >= s.maxPages) return "overrun"; // 窓が収集元に追い越された
  return "continue";
}

/**
 * 「新しい順に並ぶ一覧」用の足切り: **ページの末尾**（＝そのページで最も古い要素）が
 * cutoff より古ければ、以降のページは全部古い。
 *
 * 日付が読めない要素では止めない（`null` は「古い」と見なさない）。読めないことを理由に
 * 巡回を止めると、書式が変わった日にソースが丸ごと縮む＝取りこぼしが静かに起きる。
 */
export function lastIsOlderThan<T>(
  dateOf: (item: T) => Date | number | null | undefined,
  cutoffMs: number
): (pageItems: T[]) => boolean {
  return (pageItems) => {
    const last = pageItems[pageItems.length - 1];
    if (!last) return false;
    const d = dateOf(last);
    const ms = d instanceof Date ? d.getTime() : typeof d === "number" ? d : NaN;
    return Number.isFinite(ms) && ms < cutoffMs;
  };
}

export type CrawlPagesOptions<T> = {
  /** ログと例外メッセージに出す名前（ソース名） */
  label: string;
  /** ページ番号（1始まり）から URL を組む */
  urlOf: (page: number) => string;
  /** 1ページ分の本文から要素を取り出す。**新しい順に並んでいること**（足切りが末尾を見る） */
  parse: (body: string, page: number) => T[];
  /** 要素の同一性キー（重複ページ・無限ページ対策） */
  keyOf: (item: T) => string;
  /**
   * このページまで来たら以降は見なくてよいか（足切り）。暦で流れる一覧では**必ず渡す**
   * （渡さないと「新規0」だけが終端になり、600ページある一覧を最後まで舐める）。
   *
   * 判定をページ単位にしてあるのは、一覧の並びがソースごとに違うため。新しい順に素直に
   * 並ぶ一覧は `lastIsOlderThan` で足りるが、固定表示(sticky)の記事が混ざる一覧は
   * 末尾の1件では決められない（tenbaiquest が実際にそう）。**並びの癖を知っている
   * スクレイパー側に決めさせる**。
   */
  isPageOld?: (pageItems: T[]) => boolean;
  /** ループ暴走を止める安全弁。**足りなくなったら例外になる**ので、余裕を持って置く */
  maxPages: number;
  /** ページ間の待ち時間（ミリ秒） */
  sleepMs?: number;
  /** 取得関数（JSON API や文字コード検出が要るソースは差し替える） */
  fetchPage?: (url: string) => Promise<string>;
};

/**
 * 一覧を**終端まで**辿って要素を集める（重複キーは最初のものを残す）。
 *
 * @throws 上限ページに達してもまだ新規が出続けているとき（＝窓が収集元に追い越された）
 */
export async function crawlPages<T>(o: CrawlPagesOptions<T>): Promise<T[]> {
  const get = o.fetchPage ?? fetchHtml;
  const byKey = new Map<string, T>();
  let pages = 0;
  for (let page = 1; page <= o.maxPages; page++) {
    pages = page;
    let body: string;
    try {
      body = await get(o.urlOf(page));
    } catch {
      break; // 次ページが無い（404）＝終端
    }
    const list = o.parse(body, page);
    let added = 0;
    for (const it of list) {
      const k = o.keyOf(it);
      if (byKey.has(k)) continue;
      byKey.set(k, it);
      added++;
    }
    const reachedOld = !!(o.isPageOld && list.length > 0 && o.isPageOld(list));
    const decision = crawlDecision({ page, added, reachedOld, maxPages: o.maxPages });
    if (decision === "stop") break;
    if (decision === "overrun")
      throw new Error(
        `${o.label}: ${o.maxPages}ページまで辿ってもまだ新規が出続けている（累計${byKey.size}件）。` +
          `窓が収集元の規模に追い越されている＝取りこぼしたまま成功扱いになるので止める`
      );
    await sleep(o.sleepMs ?? 400);
  }
  // **どこまで辿ったかを毎回ログに出す。** 窓が実際に効いているかは、この数字を上限
  // (maxPages) と見比べれば分かる（上限に張り付いていたら、例外になる前に気付ける）。
  console.log(`[crawl] ${o.label}: ${pages}ページ / ${byKey.size}件（上限${o.maxPages}）`);
  return [...byKey.values()];
}
