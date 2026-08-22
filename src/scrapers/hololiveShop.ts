import { ScrapedItem } from "./types";
import { fetchHtml, parseJapaneseFullDate, parseJapaneseYearMonth, monthPlanDate, sleep, type ShopifyProduct } from "./util";
import { crawlPages } from "./crawl";
import { isGenericImageUrl } from "./imagePick";
import { jstCalDate, todayJst } from "../lib/date";
import { EN_ONLY_SCOPE } from "../lib/scope";

// hololive production OFFICIAL SHOP（Shopify）＝**ホロライブグッズの一次情報**。
//
// なぜ足したか: ミス6（ホロライブ×極楽湯タオル＝収集元にあるのにサイトに無い）で露呈した
// 「本命カテゴリの一次情報ゼロ」の穴。受注生産・数量限定が多く、受注期間を逃すと二度と
// 買えない（＝サイトの訴求そのもの）。2026-07-28 の候補調査から挙がり続けて未実装だった。
//
// 取得方式（2026-08-21 実測）:
//  - 新着は店舗レベルの公開JSON `/products.json`（published_at 降順）で拾う。
//    ちいかわ型の「日付別コレクション」は**この店には無い**。
//  - 受注の締切は products.json に無く、**商品ページの `Pdt_shipping` 節にだけある**:
//      受注生産商品 … 「受注受付期間 : 2026年08月20日 20時00分 ～ 2026年09月24日 18時00分」
//      予約販売     … 期間なし・「発送予定日：2026年09月中旬までに発送」のみ
//    → タグが 受注生産商品/予約販売/販売開始前 の行だけ商品ページを開いて締切を取る。
//
// 【掲載方針】url は公式ショップの商品ページ（一次情報）＝直リンクしてよい。

const STORE = "https://shop.hololivepro.com";
/**
 * 「直近◯日の新着」＝**日本語面に載せる**窓。日本の読者にとっては新着でなくなった時点で
 * 価値が無いので、この窓の外は JP に出さない（従来どおり）。
 *
 * 2026-08-22（Phase 3b）まで、窓の外は**返さないので DB から消えていた**。海外の読者には
 * 「日本の店にしか無い物」という価値が残るので、窓の外でも在庫がある行は
 * `scope="en"`（EN専用カタログ）として**保持する**ようにした（src/lib/scope.ts）。
 */
export const HOLO_RECENT_DAYS = 30;
/**
 * 商品ページを開く上限（収集元への負荷の保険）。窓内の受注商品は実測で数十件。
 * 窓外の分は HOLO_OUTSIDE_DETAIL_BUDGET で別枠にする。
 */
const MAX_DETAIL_PER_RUN = 90;
/**
 * 窓の外の受注/予約商品を「まだ締切前か」確かめるために開く上限（**新しい順**）。
 *
 * なぜ要るか（2026-08-22 実測・観点D）: 公開から30日を過ぎていても**受注受付が続いている**
 * 商品がある。窓で切っていたので、`1/7スケールフィギュア さくらみこ`（締切 8/24＝実測日の
 * 2日後）と `ピクロス™ …箱根探訪編 同梱版`（締切 8/31）が**サイトのどこにも出ていなかった**。
 * 締切がある商品はハツコレの本命そのものなので、これは EN の話ではなく **JP の取りこぼし**。
 *
 * なぜ**新しい順**か: 窓外285件を全部開いて未来締切だったのは2件で、**どちらも新しい側の
 * 40件の中**にあった（受注期間は概ね1〜2ヶ月なので、古い行に開いている窓は実際上ない）。
 * 「古い順に一巡させる」（figisland_pb の形）はここでは逆効果になる。
 */
const HOLO_OUTSIDE_DETAIL_BUDGET = 60;
/**
 * 商品ページを開く間隔。**300ms は速すぎる疑いがある。**
 * 実測（2026-08-22）: 150ms 間隔で 285件を開くと **148件(52%)が失敗**した。同じ対象40件を
 * 700ms で引き直すと **40/40 成功・失敗0**。＝収集元の壁ではなく、こちらが速すぎただけ
 * （[[System/rules_hatsukore]]「本番が壊れていると言う前に測定器を疑う」）。
 * 従来の 300ms は未検証のまま動いており、窓内の締切取得も静かに落としていた可能性がある。
 */
const DETAIL_SLEEP_MS = 700;
/**
 * カタログ行のバッジに出す種別。**「発売」にしてはいけない**: 英語表示が "Release" になり、
 * とうに発売済みの在庫品が「これから発売する」と読める（実測 2026-08-22・実装中に発見）。
 * 「登場済み」は既存の語彙（PAST_TENSE_LABELS の到達点）で、英語は "Out now"＝
 * *もう出ている* という**商品についての事実**。在庫があるとは言っていない。
 */
const CATALOG_EVENT_TYPE = "登場済み";

/** 受注・予約系のタグ（この行だけ商品ページを開く） */
export function isHoloPreorder(tags: string[]): boolean {
  return tags.some((t) => /受注生産|予約販売|販売開始前/.test(t));
}

/**
 * **ダウンロード販売を含む出品**（ボイス・ボイスドラマ・デジタル特典つき記念セット等）。
 * 店自身が付けているタグで判定する（こちらが中身から推測しない）。
 *
 * EN専用カタログからはこれを外す。ENカタログの前提は「日本の店にしか無い**物**を、
 * 代行（proxy/forwarding）で取り寄せる」＝ /en/how-to-buy が説明している経路そのもので、
 * 発送物が無い商品にはその経路が成立しない。**日本語面の扱いは変えない**
 * （窓内のデジタル商品は従来どおり載る）。
 *
 * 🔴 **「デジタルのみ」だけを外すのでは足りない**（2026-08-22・実装中に画面を通読して発見）:
 * 最初はその完全一致だけを外したが、出来上がったカタログの先頭が **2021年の誕生日記念**で
 * 埋まった。実ページを開くと全部「ダウンロード販売」で、`デジタルコンテンツ` タグは付くが
 * `デジタルのみ` は付いていなかった。**デジタルは売り切れないので永久に在庫あり**として
 * 残り続ける＝古い順に並ぶカタログの正体がこれだった。
 *
 * 実測（窓外・在庫あり1177件）: デジタル系タグを全部外すと **547件**が残り、公開年は
 * 2023:91 / 2024:233 / 2025:136 / 2026:84（＝物はちゃんと売り切れていく）。残った側の
 * 抜き取り4件は全て実ページに「発送」があり「ダウンロード販売」が無いことを確認済み。
 */
export function isHoloDigitalListing(tags: string[]): boolean {
  return tags.some((t) => t.includes("デジタル"));
}

/**
 * この行を EN専用カタログ（scope="en"）に載せるか／JPにも出すか／載せないかを決める純関数。
 * **鳴る側・鳴らない側を audit:selftest で固定する**ので、判定をスクレイパー本体に埋めない。
 */
export type HoloPlacement = "jp" | "en-only" | "skip";

export function holoPlacement(input: {
  /** products.json の published_at（epoch ms） */
  publishedMs: number;
  /** 窓の下限（epoch ms）。これより古い＝日本語面の新着ではない */
  cutoffMs: number;
  tags: string[];
  available: boolean;
  /** 受注受付の締切が未来だと確かめられたか（詳細を開いていない/期間が無い場合は false） */
  hasFutureDeadline: boolean;
}): HoloPlacement {
  if (!Number.isFinite(input.publishedMs)) return "skip";
  // 窓の内側は従来どおり日本語面（在庫の有無は呼び出し側の従来ロジックが決める）。
  if (input.publishedMs >= input.cutoffMs) return "jp";
  // 窓の外でも、**まだ締切前の受注**は「逃すと買えない」行＝日本語面にも出す。
  if (input.hasFutureDeadline) return "jp";
  // ここから先は EN専用カタログの資格審査。
  if (!input.available) return "skip"; // 売り切れは載せない（押した先が行き止まり）
  if (isHoloDigitalListing(input.tags)) return "skip"; // 発送物が無い＝代行の経路が成立しない
  return "en-only";
}

export type HoloSchedule = {
  periodEnd: Date | null;
  periodRaw: string | null; // 「2026年08月20日 20時00分 ～ 2026年09月24日 18時00分」
  shipRaw: string | null; // 「2026年09月中旬までに発送」
  shipMonthDate: (today: Date) => Date | null;
};

/** 商品ページから受注受付期間・発送予定日を読む（純関数・selftest対象）。 */
export function parseHoloSchedule(html: string): HoloSchedule {
  const period = html.match(/受注受付期間<\/span>\s*[:：]\s*([^<]+?)\s*<\/p>/)?.[1]?.replace(/\s+/g, " ").trim() ?? null;
  let periodEnd: Date | null = null;
  if (period) {
    const parts = period.split(/[～〜]/);
    periodEnd = parts.length >= 2 ? parseJapaneseFullDate(parts[1]) : null;
  }
  const ship = html.match(/発送予定日<\/span>\s*[:：]?\s*([^<]{2,60})/)?.[1]?.replace(/\s+/g, " ").trim() ?? null;
  return {
    periodEnd,
    periodRaw: period,
    shipRaw: ship,
    shipMonthDate: (today) => {
      const ym = ship ? parseJapaneseYearMonth(ship) : null;
      return ym ? monthPlanDate(ym.getUTCFullYear(), ym.getUTCMonth() + 1, today) : null;
    },
  };
}

/**
 * 商品画像を選ぶ（純関数・selftest対象）。
 *
 * この店の images[0] は「holo_◯◯_banner_JP_◯◯.png」のような**告知バナー**であることが
 * 多く（実測: 250商品中136枚が banner 名）、保存側の汎用画像フィルタ（isGenericImageUrl）に
 * 落とされて画像なしになっていた。商品写真は配列の後ろにあるので、**汎用判定に落ちない
 * 最初の1枚**を選ぶ。全部バナーなら null（推測画像を付けない）。
 */
export function holoImage(images: { src: string }[] | undefined): string | null {
  for (const img of images ?? []) {
    if (img.src && !isGenericImageUrl(img.src)) return img.src;
  }
  return null;
}

/**
 * variant のタイトルに入っている販売単位を商品名に足す（純関数・selftest対象）。
 *
 * 実測（audit `price_unit_suspect`）: 商品名「ブースターパック「ボリュームヴォルテックス」」に
 * 5,280円が付き「単パックがBOX価格?」と鳴った。実体は variant 名が
 * 「…（BOX：12パック入り）」の**BOX売り**。販売単位は価格の意味そのものなので、
 * variant が BOX と言っているのに商品名が言っていない行は商品名に単位を足す。
 */
export function holoTitleWithUnit(title: string, variantTitle: string | undefined): string {
  if (!variantTitle || /BOX|ボックス/i.test(title)) return title;
  const m = variantTitle.match(/[（(](BOX[^（）()]*)[）)]/i);
  return m ? `${title}（${m[1]}）` : title;
}

/** タイトル → サイトのジャンル語彙（GENRE_ORDER が唯一の定義）。 */
export function holoGenre(title: string): string {
  if (/カードゲーム|ブースターパック|スターターデッキ|ホロカ/i.test(title)) return "トレカ";
  if (/figma|ねんどろいど|フィギュア|POP UP PARADE|スケール/i.test(title)) return "フィギュア";
  if (/ソフビ/.test(title)) return "ソフビ・アートトイ";
  return "キャラグッズ";
}

type HoloProduct = ShopifyProduct & { tags: string[] };

export async function scrapeHololiveShop(): Promise<ScrapedItem[]> {
  const today = todayJst();
  const cutoffMs = today.getTime() - HOLO_RECENT_DAYS * 86_400_000;

  // 店舗レベルの products.json は published_at 降順（実測）。**カタログを終端まで**辿る
  // （Phase 3b）。以前は窓の日付で足切りしていたが、窓の外にも「日本の店にしか無い在庫品」＝
  // 海外の読者に価値がある行が残るので、全部取ってから scope で振り分ける。
  // 実測 2026-08-22: 全2425件・11ページ・11.8秒（足切りを外しても十分に軽い）。
  const products = await crawlPages<HoloProduct>({
    label: "hololive_shop",
    urlOf: (page) => `${STORE}/products.json?limit=250&page=${page}`,
    parse: (body) => {
      const data = JSON.parse(body) as { products?: HoloProduct[] };
      return data.products ?? [];
    },
    keyOf: (p) => p.handle,
    // isPageOld は渡さない＝終端（新規0）まで辿る。上限は実測11ページに対する安全弁。
    maxPages: 30,
    sleepMs: 300,
  });
  // 0件は「新商品が無い」ではなく取得の壊れ（API仕様の変化等）とみなして赤くする。
  if (products.length === 0) throw new Error("hololive_shop: products.json が0件（API仕様の変化を疑う）");

  const items: ScrapedItem[] = [];
  let detailFetched = 0;
  let outsideDetailFetched = 0;
  // ループ変数を `p` にしない: crawlLint はページ番号らしき変数（p を含む）のループ内 fetch を
  // 「自前のページ送り」と見なす。これは配列を回す詳細取得ループ＝対象外の形だと名前で示す。
  for (const product of products) {
    const publishedMs = Date.parse(product.published_at);
    if (!Number.isFinite(publishedMs)) continue;
    const tags = Array.isArray(product.tags) ? product.tags : [];
    const available = !!product.variants?.some((v) => v.available);
    const inWindow = publishedMs >= cutoffMs;
    const title = holoTitleWithUnit(product.title.replace(/\s+/g, " ").trim(), product.variants?.[0]?.title);
    if (!title) continue;
    const yen = Number(product.variants?.[0]?.price ?? 0);
    const base = {
      source: "hololive_shop",
      sourceId: product.handle,
      title,
      genre: holoGenre(title),
      subGenre: "ホロライブ",
      price: yen ? `${yen.toLocaleString()}円` : null,
      url: `${STORE}/products/${product.handle}`,
      imageUrl: holoImage(product.images),
      // 店に並んだ日。イベント日ではないので eventDate には入れない（カタログの並び順用）。
      storeListedAt: new Date(publishedMs),
    };

    // ── 窓の外: 受注/予約タグの行だけ、締切が生きていないかを新しい順に確かめる ──
    // products.json が published_at 降順なので、このループの順序がそのまま「新しい順」。
    let sched: HoloSchedule | null = null;
    if (!inWindow && available && isHoloPreorder(tags) && outsideDetailFetched < HOLO_OUTSIDE_DETAIL_BUDGET) {
      outsideDetailFetched++;
      try {
        sched = parseHoloSchedule(await fetchHtml(base.url));
      } catch {
        sched = null; // 取得できなかった行は「締切なし」として扱う＝カタログ側に落ちるだけ
      }
      await sleep(DETAIL_SLEEP_MS);
    }
    const hasFutureDeadline = !!sched?.periodEnd && sched.periodEnd.getTime() >= today.getTime();

    const placement = holoPlacement({ publishedMs, cutoffMs, tags, available, hasFutureDeadline });
    if (placement === "skip") continue;

    if (placement === "en-only") {
      // EN専用カタログ行。**日付を持たせない**（発売はとうに済んでいるので「予定」ではない）。
      // 画面に出すのは「この日にまだ店にあった」＝ scrapedAt から表示時に作る事実だけで、
      // 在庫・海外購入の可否・入手容易さは**約束しない**（[[UIラベルは裏取り済みのみ約束]]）。
      items.push({
        ...base,
        eventType: CATALOG_EVENT_TYPE,
        eventDate: null,
        eventDateText: null,
        scope: EN_ONLY_SCOPE,
      });
      continue;
    }

    // ── ここから placement === "jp"（従来の日本語面）──
    if (isHoloPreorder(tags)) {
      // 締切は商品ページにしかない。取得に失敗した行は**返さない**＝前回の正しい締切を
      // null で潰さない（figisland_pb と同じ判断）。
      if (!sched) {
        if (detailFetched >= MAX_DETAIL_PER_RUN) continue;
        try {
          sched = parseHoloSchedule(await fetchHtml(base.url));
        } catch {
          await sleep(DETAIL_SLEEP_MS);
          continue;
        }
        detailFetched++;
        await sleep(DETAIL_SLEEP_MS);
      }
      if (sched.periodEnd) {
        // 掲載範囲を決めるのは受付の**最後の締切**。文言も保存して突合できるようにする。
        items.push({
          ...base,
          eventType: "予約",
          eventDate: sched.periodEnd,
          eventDateText: `受注受付期間 ${sched.periodRaw}`,
        });
      } else {
        // 予約販売（締切なし）は発送予定月を予定日に（月初が過ぎていれば日付未定＝文言だけ）。
        items.push({
          ...base,
          eventType: "予約",
          eventDate: sched.shipMonthDate(today),
          eventDateText: sched.shipRaw,
        });
      }
      continue;
    }

    // 在庫販売の新着（日付なし＝「いま買える」）。売り切れは載せない
    // （押した先が品切れ＝行き止まりになる。[[UIラベルは裏取り済みのみ約束]]）。
    if (!available) continue;
    const appeared = jstCalDate(publishedMs);
    items.push({
      ...base,
      eventType: "発売",
      eventDate: null,
      eventDateText: `登場 ${appeared.getUTCMonth() + 1}/${appeared.getUTCDate()}`,
    });
  }
  return items;
}
