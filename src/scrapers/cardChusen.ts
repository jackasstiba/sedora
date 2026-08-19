import { ScrapedItem } from "./types";
import { fetchHtml, resolveMonthDay } from "./util";
import { readPageText, verifyStoreUrls } from "./verifyStoreUrl";
import { decodeHtmlEntities, stripTags } from "./aggregatorUtil";
import { lastDeadline, preferredStoreUrl, summarizeStores } from "../lib/stores";
import { todayJst } from "../lib/date";

// 「今日」は必ず src/lib/date.ts の todayJst()（日本時間の暦日）から取る。
// 以前ここに `reference = new Date()` と独自の +9h 実装があり、parseDue が
// `reference.getUTC*()` を読んでいたため、**日本時間 09:00 より前に巡回した回だけ**
// UTC上はまだ前日で、収集元の「締切 本日 22:00」が1日早く解決されていた。
// 実測（2026-08-16 06:39 JST ＝ 21:39Z の巡回）: 締切付き197枠のうち 93枠(47%) が
// 前日に解決され、**まだ今日応募できる抽選を「昨日締切」と表示**していた。

// カード抽選まとめ（cardchusen.com）: ポケカ/ワンピ/遊戯王/DB の**店舗別抽選**を
// 締切順に集約する非公式アグリ。実測（2026-08-15）: 受付中306件＋近日9件が
// 静的HTML（1.65MB）に全部入り。各カード（.board-card）＝商品名（.board-card__store の
// title属性）・店名（同要素の本文）・締切/開始（.board-card__due）・応募条件タグ
// （.board-cond__txt: SNS応募/会員/レシート等）・**応募ページへの直リンク**（.board-card__cta）。
//
// 【方針】収集元は完全非公開（[[収集元の扱い方]]）。item.url は各店の応募ページ
// （e-starbox抽選システム/店舗X告知/店舗サイト＝一次情報）に直リンクし、
// cardchusen の名・リンクは一切出さない。
//
// 【粒度】カードは「店×商品」だが、ハツコレは「商品」が1行（受付中ストアは stores 列）。
// 商品名は店ごとに表記ゆれが激しい（「ポケモンカード ストームエメラルダ」↔
// 「ポケモンカードゲーム MEGA 拡張パック「ストームエメラルダ」」↔ 語順違いの OP-17）ので、
// ゲーム接頭辞・商品種別語・記号を落とした残りを**文字ソート（anagram）**で束ねる
// （語順違いの名寄せは dedupeWordOrderCrossSource と同じ考え方）。

const HOME = "https://cardchusen.com/";


/**
 * 商品名に混ざった「その店の売り方」を切り離す（＝弾名だけを残す）。
 *
 * 直す対象（2026-08-18 実測・本番トップの1画面目）: OP-17 が **10行**に割れていた。
 * 「…【OP-17】 1BOX（5,760円税込・現金払いのみ）」「…【OP-17】（事前抽選による予約販売）」の
 * ように、店が商品名欄に自店の条件を書き足すと productKey が別商品として束ねるため。
 * 物は同じ1つの弾で、違うのは応募する店だけなので、読む側には**同じカードが並ぶだけ**に見える
 * （「受付中ストアの同じ表記が並ぶ」「同名のまとめ記事が2行」と同じ粗）。実測 293枠のうち、
 * 条件を切り離すと 71商品 → 42商品（＝29行が同じ商品の分身だった）。
 *
 * **切ってよいのは条件だけ。** 括弧の中身は条件とは限らず、
 * 「御三家カードセット（フシギダネ・ヒトカゲ・ゼニガメ）」の8種のように**中身が別商品**の
 * ことがある。括弧を一律に落とすとこの8行が1行に潰れて7つの抽選が画面から消える。
 * 中身が条件語（金額・支払い・数量・購入権・再販・開封/受け渡し等）に当たるときだけ落とす。
 * この条件で本番の全枠を通し、誤って束ねた組が無いことを目視で確認した。
 *
 * 切り離した条件は捨てずに、その店の `note`（＝「条件:」行）へ回す。「現金払いのみ」
 * 「おひとり様1BOX」は当落と手残りを左右する＝せどらーが見る情報なので、消してはいけない。
 */
const SALE_COND =
  /現金|税込|税抜|[\d,]+円|購入権|抽選|予約|販売|再販|再入荷|おひとり|お一人|お1人|一人様|数量限定|限定販売|個数限定|台数限定|開封|シュリンク|お渡し|引き渡し|引換|当選|応募|店頭|来店|通販|オンライン|送料|希望小売価格|\d+\s*(?:BOX|箱|パック|カートン|個|セット|点|口|名|種)|全\d+種/i;

export function splitSaleConditions(name: string): { base: string; conds: string[] } {
  const conds: string[] = [];
  let t = name.normalize("NFKC");
  t = t.replace(/[（(【\[]([^）)】\]]*)[）)】\]]/g, (m, inner: string) => {
    const s = inner.trim();
    if (!SALE_COND.test(s)) return m; // 中身の列挙・キャラ名＝別商品なので残す
    conds.push(s);
    return " ";
  });
  // 括弧の外に出る数量（「…【OP-17】 2BOX」）。単位が続く数だけを見るので
  // 「スタートデッキ100」「30th CELEBRATION BOX」は触らない。
  t = t.replace(/\d+\s*(?:BOX|箱|カートン|パック|セット|個|口)/gi, (m) => {
    conds.push(m.trim());
    return " ";
  });
  // 括弧の外に出る状態の書き足し（「…「ストームエメラルダ」未開封BOX」）。単位まで一緒に
  // 外さないと BOX だけが名前に残り、同じ弾が別行のままになる。**この語が付いている時だけ**
  // 単位を外す＝「30th CELEBRATION BOX」のように BOX が商品名の一部の行は触らない。
  t = t.replace(/(?:未開封|シュリンク(?:付き?)?|開封済み?)\s*(?:BOX|箱)?/gi, (m) => {
    conds.push(m.trim());
    return " ";
  });
  const base = t.replace(/\s+/g, " ").trim();
  return { base: base || name, conds };
}

/** 定型語を削った「弾名」の文字列（dropCode=true なら型番も落とす）。 */
function bulletChars(name: string, dropCode: boolean): string {
  let t = name.normalize("NFKC");
  // 型番（【OP-17】 / [26LP] / 括弧なしの OP-17）。**書く店と書かない店がいる**ので、
  // 落とせる時は落として突合する（実測: 遊戯王 26LP は1店だけが型番付きで別行になっていた）。
  // 英字と数字が混じるトークンだけを型番とみなす。「151」「100」のような数字だけの弾名は
  // それが唯一の手掛かりなので落とさない。
  if (dropCode) t = t.replace(/(^|[^A-Za-z0-9])([A-Za-z]+-?\d+|\d+-?[A-Za-z]+)($|[^A-Za-z0-9])/g, "$1 $3");
  // 空白は先に落とす。「遊戯王OCG デュエルモンスターズ」と「遊戯王OCGデュエルモンスターズ」で
  // 定型語の当たり方が変わり、同じ商品が別キーになっていた（実測: 遊戯王 26LP）。
  // 記号は**定型語を消す前に**落とす。「遊☆戯☆王」は記号を挟むだけで
  // 「遊戯王」のパターンに当たらず、同じ商品が別キーになっていた。
  t = t.toLowerCase().replace(/[「」『』【】\[\]()（）・、。！!？?\s　©®™☆★-]/g, "");
  // ゲーム名・商品種別・販売単位の定型語を除去して「弾名」を残す
  return t
    .replace(/ポケモンカードゲーム|ポケモンカード|ポケカ|one\s*pieceカードゲーム|ワンピースカードゲーム|ワンピースカード|遊戯王(?:ocg)?(?:デュエルモンスターズ)?|デュエルマスターズ|デュエマ|ドラゴンボール(?:超|スーパー)?カードゲーム|フュージョンワールド|バトルスピリッツ|ヴァイスシュヴァルツ|ユニオンアリーナ|デジモンカードゲーム/g, "")
    .replace(/mega|拡張パック|強化拡張パック|ブースターパック|スタートデッキ|スターターデッキ|プレミアムデッキセット|ハイクラスパック|デッキビルドパック|コンセプトパック|boxセット?|カートン|1box|予約|抽選|受付中?/g, "")
    .replace(/[「」『』【】\[\]()（）・、。！!？?\s©®™☆★-]/g, "");
}

/** 商品名からグループ化キーを作る（表記ゆれ・語順ゆれ・店ごとの販売条件を吸収）。 */
export function productKey(name: string): string {
  const { base } = splitSaleConditions(name);
  const withCode = bulletChars(base, false);
  const noCode = bulletChars(base, true);
  // 型番を落とすのは**落としても弾名が残るときだけ**。「ブースターパック【OP-17】」のように
  // 型番しか手掛かりが無い名前まで落とすと、別の弾と同じキー（＝空）になって束ねてしまう。
  const t = noCode.length >= 6 ? noCode : withCode;
  // 語順ゆれ（OP-17 世界最強の戦士 ↔ 世界最強の戦士 OP-17）は文字ソートで吸収する。
  // ただし3文字以下は文字ソートすると別商品と偶然一致しうる（151 と 115）。その長さでは
  // 語順ゆれ自体が起きないので、短いときはソートしない。
  const sorted = [...t].sort().join("");
  return sorted.length <= 3 ? t : sorted;
}

/**
 * 「締切 本日 22:00」「開始 8/17(月) 10:00」等 → 期日と表示文字列。調査中は null。
 *
 * **収集元の「本日/明日」を label に残さない。** 収集元は毎日書き換わる相対表記を使うが、
 * こちらは巡回した時点の文字列を DB に保存して手動更新まで出し続けるので、保存した瞬間から
 * 日ごとにズレる（実測 2026-08-16: 前夜22:49に取った「〜明日 22:00」が、翌0時には
 * 実際の締切より1日先を指していた）。ここでは必ず暦日に解決して絶対表記にし、
 * 「本日/明日」は表示時に storeWhenLabel が today から作る。
 */
export function parseDue(
  text: string,
  reference = todayJst()
): { kind: "締切" | "開始"; date: Date | null; label: string } | null {
  const t = text.replace(/\s+/g, " ").trim();
  const m = t.match(/^(締切|開始)\s*(.+)$/);
  if (!m) return null;
  const kind = m[1] as "締切" | "開始";
  const rest = m[2].trim();
  if (/調査中/.test(rest)) return { kind, date: null, label: `${kind}時刻 調査中` };

  const time = rest.match(/(\d{1,2}:\d{2})/)?.[1] ?? null;
  let date: Date | null = null;
  if (/^本日/.test(rest)) {
    date = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate()));
  } else if (/^明日/.test(rest)) {
    const d = new Date(reference.getTime() + 86_400_000);
    date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  } else {
    const md = rest.match(/(\d{1,2})\/(\d{1,2})/);
    if (!md) return { kind, date: null, label: `${kind} ${rest}` };
    date = resolveMonthDay(Number(md[1]), Number(md[2]), reference);
  }
  const dayLabel = `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
  const label = kind === "締切" ? `〜${dayLabel}${time ? " " + time : ""}` : `${dayLabel}${time ? " " + time : ""}〜`;
  return { kind, date, label };
}

// 商品接頭辞 → subGenre（/tcg タイトルページのマッチに使われる）
const GAME_LABELS: [RegExp, string][] = [
  [/ポケモンカード|ポケカ/i, "ポケモンカード"],
  [/one\s*piece|ワンピース/i, "ワンピースカード"],
  [/遊戯王/i, "遊戯王"],
  [/ドラゴンボール|フュージョンワールド/i, "ドラゴンボールカード"],
  [/デュエル・?マスターズ|デュエマ/i, "デュエマ"],
];

type Entry = {
  product: string;
  store: string;
  url: string;
  due: ReturnType<typeof parseDue>;
  conds: string[];
};

/** 一覧HTMLから店×商品の応募枠を全部取り出す（純関数・selftest対象）。 */
export function parseCardChusen(html: string, reference = todayJst()): Entry[] {
  const body = html.slice(html.indexOf("</head>"));
  const out: Entry[] = [];
  for (const m of body.matchAll(
    /board-card__store" title="([^"]+)"[^>]*>([\s\S]*?)<\/p>[\s\S]{0,600}?board-card__due"[^>]*>([\s\S]*?)<\/div>[\s\S]{0,300}?board-card__cta" href="([^"]+)"/g
  )) {
    const product = decodeHtmlEntities(m[1]).trim();
    const store = stripTags(m[2]);
    const due = parseDue(stripTags(m[3]), reference);
    // 応募ページURLもエンティティを戻す。`?q=…&amp;b=birthday` のまま配ると、クエリ名が
    // `amp;b` になって絞り込みが落ちる（実測 2026-08-16: しまむらパークの応募リンク）。
    // 商品名だけ decodeHtmlEntities していて、URLは素通しだった。
    const url = decodeHtmlEntities(m[4]);
    if (!product || !store || !url) continue;
    // カードの条件タグは store 要素より前にあるので、この match からは取れない。
    // 条件は直前1000字から拾う。
    const before = body.slice(Math.max(0, (m.index ?? 0) - 1000), m.index ?? 0);
    const conds = [...before.matchAll(/board-cond__txt">([^<]+)</g)].map((c) => c[1]);
    out.push({ product, store, url, due, conds: conds.slice(-3) });
  }
  return out;
}

/** 応募枠を商品単位にまとめて ScrapedItem にする（純関数・selftest対象）。 */
export function buildCardChusenItems(entries: Entry[]): ScrapedItem[] {
  const groups = new Map<string, Entry[]>();
  for (const e of entries) {
    const k = productKey(e.product);
    // 1文字まで削れた名前は何の商品か特定できないので載せない。**これ以上は締めない**:
    // 以前は4文字未満を捨てていたため、「ポケモンカード 強化拡張パック ポケモンカード151」
    // 「ポケモンカードゲーム スタートデッキ100」は定型語を削ると 151 / 100（3文字）になり、
    // 実際に受付中の抽選なのに**どのページにも出ていなかった**（実測2枠）。
    if (k.length < 2) continue;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(e);
  }

  const items: ScrapedItem[] = [];
  for (const [key, g] of groups) {
    // 代表名＝最頻の表記（同数なら短いもの）。店ごとの表記ゆれから1つに決める。
    // 突合したのと同じ「条件を外した名前」で数える＝カードの見出しに1店だけの
    // 売り方（「1BOX（5,760円税込・現金払いのみ）」）が出ないようにする。
    const freq = new Map<string, number>();
    for (const e of g) {
      const base = splitSaleConditions(e.product).base;
      freq.set(base, (freq.get(base) ?? 0) + 1);
    }
    const title = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];

    // 締切が近い順（締切なし・調査中は最後）＝詳細ページで「今すぐ応募できる店」から並ぶ。
    const sorted = [...g].sort(
      (a, b) => (a.due?.date?.getTime() ?? Infinity) - (b.due?.date?.getTime() ?? Infinity)
    );
    const stores = sorted.map((e) => {
      // 商品名から外した売り方（現金払いのみ・おひとり様1BOX・箱開封しての引き渡し）は
      // **その店の条件**。まとめた結果として消さず、条件タグと一緒にこの店の行へ残す。
      const conds = [...e.conds, ...splitSaleConditions(e.product).conds];
      return {
      name: e.store,
      url: e.url,
      form: "抽選",
      when: e.due?.label ?? null,
      note: conds.length ? conds.join("・") : null,
      // 暦日を併せて持たせる＝表示側が「本日/明日」「受付前」を today から作れる。
      at: e.due?.date ? e.due.date.toISOString().slice(0, 10) : null,
      kind: e.due?.kind ?? null,
      };
    });

    // eventDate は「**最後の締切**＝この商品を載せ続けてよい期限」にする。
    //
    // 以前はここに「巡回した日以降で最も近い締切」を入れていたが、それは *その日にしか
    // 正しくない値*だった。1商品が143店・締切8/15〜8/26という幅を持つので、翌日には
    // 最短が過去になり `eventDate >= today` の表示スコープから**商品ごと落ちた**
    // （実測 2026-08-16: #75417 はまだ締切前の店が102店あるのに本番のどの一覧にも不在）。
    // 画面に出す「いちばん急ぐ日」は表示時に today から作る（applyLiveStoreDeadline）。
    const lastDue = lastDeadline(stores);

    // item.url は「公式ページ」表示になるため、店舗ドメイン＞Googleフォーム＞X告知の順で選ぶ。
    // 選び方は表示側（詳細ページの「公式ページで見る」）と同じ関数を使う。別実装にすると
    // 片方だけ締切済みの店を指す（表示側は受付中の店だけに絞ってからこれを呼ぶ）。
    const pickUrl = preferredStoreUrl(stores) ?? sorted[0].url;
    const sub = GAME_LABELS.find(([re]) => re.test(title))?.[1] ?? null;

    items.push({
      source: "card_chusen",
      sourceId: key.slice(0, 80),
      title,
      genre: "トレカ",
      subGenre: sub,
      eventType: "抽選",
      eventDate: lastDue,
      eventDateText: lastDue ? null : "抽選 受付中",
      price: null,
      url: pickUrl,
      imageUrl: null,
      highlights: `受付中ストア：${summarizeStores(stores, 3)}`,
      hasLottery: true,
      stores: JSON.stringify(stores),
    });
  }
  return items;
}


export async function scrapeCardChusen(): Promise<ScrapedItem[]> {
  const html = await fetchHtml(HOME);
  const items = buildCardChusenItems(parseCardChusen(html));
  const r = await verifyStoreUrls("card_chusen", items, readPageText);
  console.log(`[card_chusen] 画面に出すURLの裏取り: ${r.checked}件を開いて ${r.swapped}件を差し替え`);
  return items;
}
