import { ScrapedItem } from "./types";
import { fetchHtml } from "./util";
import { nowInstant } from "../lib/date";

// Nike SNKRS の抽選/LAUNCH（応募制）商品を収集する。
// 既存の snkrdunk は「発売カレンダー」で、抽選の応募期間・締切までは拾えていない。
// スニーカーの高相場は抽選が中心なので、ここで「抽選エントリ＋応募/発売日時」を補う。
//
// 取得方式: launchページは JS 描画SPA だが、Next.js の __NEXT_DATA__ に初期ステートが
// 埋め込まれており素の fetch で取得できる（pokemonGoods/pokemonCard と同じ「SPAだがJSON直取り」型）。
// ステートは props.pageProps.initialState に JSON文字列として二重エンコードされている。
const LAUNCH_URL = "https://www.nike.com/jp/launch";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

function extractNextData(html: string): Json | null {
  const m = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

// initialState は文字列(二重エンコード)のことも、稀にオブジェクトのこともある。両対応。
function getInitialState(next: Json): Json | null {
  const raw = next?.props?.pageProps?.initialState;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (raw && typeof raw === "object") return raw;
  return null;
}

// threads から productId -> SEOスラッグ を引けるようにする（商品URL生成用）。
function buildSlugMap(threads: Record<string, Json>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const th of Object.values(threads)) {
    const slug: string | undefined = th?.seo?.slug;
    if (!slug) continue;
    const ids: string[] =
      Array.isArray(th?.productIds) && th.productIds.length
        ? th.productIds
        : th?.productId
          ? [th.productId]
          : [];
    for (const id of ids) if (!map[id]) map[id] = slug;
  }
  return map;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

// ISO日時 -> JST(Asia/Tokyo)の暦日・時分。本番はUTCで動くため、時刻加算でJSTに寄せてから分解する。
function jstParts(iso: string): { y: number; mo: number; d: number; h: number; mi: number } {
  const t = new Date(iso).getTime() + 9 * 60 * 60 * 1000;
  const j = new Date(t);
  return {
    y: j.getUTCFullYear(),
    mo: j.getUTCMonth() + 1,
    d: j.getUTCDate(),
    h: j.getUTCHours(),
    mi: j.getUTCMinutes(),
  };
}

// 暦日は「時刻を持たない日」として UTC 0時で作る（util.ts の calDate と同じ規約）。
function calDateUtc(y: number, mo: number, d: number): Date {
  return new Date(Date.UTC(y, mo - 1, d));
}

// Nikeの日時は多くが「その日のUTC0時」＝日付のみ（実ドロップ時刻ではない）。
// UTC0時をJSTに寄せると偽の「9:00」になるため、時刻が実在するとき(UTCで非0時)だけ時刻を出す。
function hasRealTime(iso: string): boolean {
  const d = new Date(iso);
  return d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0;
}

// 大人版とキッズ版は SNKRS 上で**同じ日本語タイトル**のことがある（実測: GS版「コービー 5」
// ¥15,620 と大人版「コービー 5 "Hyper Royal"」¥22,000 が同一 launch URL・同一画像で並び、
// キッズと分かる表記がどこにも無かった＝大人靴と誤解して応募し得る）。
// subtitle（「ジュニア バスケットボールシューズ」等）と genders(KIDS) から区別を作り、
// タイトルに付ける。subtitle の語をそのまま使う（勝手な言い換えをしない）。
export function kidsLabel(subtitle: unknown, genders: unknown): string | null {
  const sub = typeof subtitle === "string" ? subtitle : "";
  const g = Array.isArray(genders) ? genders : [];
  const m = sub.match(/(リトルキッズ|ベビー|ジュニア|キッズ)/);
  if (m) return m[1];
  if (g.includes("KIDS")) return "キッズ";
  return null;
}

function formatYen(price: unknown, currency: unknown): string | null {
  if (typeof price !== "number" || !isFinite(price)) return null;
  if (currency && currency !== "JPY") return `${price.toLocaleString("ja-JP")} ${currency}`;
  return `¥${price.toLocaleString("ja-JP")}`;
}

export async function scrapeNikeSnkrs(): Promise<ScrapedItem[]> {
  const html = await fetchHtml(LAUNCH_URL);
  const next = extractNextData(html);
  const state = next ? getInitialState(next) : null;
  const product = state?.product;
  const launchViews: Record<string, Json> = product?.launchViews?.data?.items ?? {};
  const products: Record<string, Json> = product?.products?.data?.items ?? {};
  const threads: Record<string, Json> = product?.threads?.data?.items ?? {};

  const slugMap = buildSlugMap(threads);
  const items: ScrapedItem[] = [];

  // 過去に落ちた抽選は載せない（サイト側でも過去は除外されるが二重防御）。
  const cutoff = nowInstant().getTime() - 2 * 24 * 60 * 60 * 1000;

  // launchViews に載る＝LAUNCH商品（抽選 DRAW / 先着 LINE）。通常の常時販売品は除外される。
  for (const [productId, entry] of Object.entries(launchViews)) {
    const p = products[productId];
    if (!p) continue;

    const commerce: string | undefined = p.commerceStartDate;
    if (!commerce) continue;

    const c = jstParts(commerce);
    const eventDate = calDateUtc(c.y, c.mo, c.d);
    if (eventDate.getTime() < cutoff) continue;

    // launchViews に載る＝応募制、ではない。SNKRS の launch には2方式あり、
    // `method` がそれを持っている:
    //   DRAW … 抽選（応募期間があり、当選者だけが買える）
    //   LINE … 先着（発売時刻に並ぶ＝早い者勝ち。抽選ではない）
    // 実測: 「ナイキ リジュビネイト ラン」は method=LINE（SNKRSの表示も「8/10 0:00 より販売開始」）
    // なのにハツコレは「抽選」と出し、/lottery にも載せていた。先着を抽選と書くと、
    // せどらーは「応募すれば当たるかも」と読んで実際には売り切れに間に合わない。
    const isDraw = entry?.method === "DRAW";
    const eventType = isDraw ? "抽選" : "発売";

    // 抽選は「いつまでに応募するか」、先着は「いつ売り出すか」が勝負どころ。
    // 時刻は実在するときだけ出す（Nikeの日付のみの値は UTC 0時＝偽の時刻になる）。
    let eventDateText: string;
    if (isDraw && entry?.stopEntryDate) {
      const s = jstParts(entry.stopEntryDate);
      const time = hasRealTime(entry.stopEntryDate) ? ` ${s.h}:${pad2(s.mi)}` : "";
      eventDateText = `抽選応募締切 ${s.mo}/${s.d}${time}`;
    } else {
      const time = hasRealTime(commerce) ? ` ${c.h}:${pad2(c.mi)}` : "";
      eventDateText = `${isDraw ? "抽選" : "先着販売"} ${c.mo}/${c.d}${time}`;
    }

    let title: string = (p.title ?? "").trim();
    if (!title) continue;
    const kids = kidsLabel(p.subtitle, p.genders);
    if (kids && !title.includes(kids)) title = `${title}（${kids}）`;

    const styleColor: string | undefined = p.styleColor;
    const slug = slugMap[productId];

    items.push({
      source: "nike_snkrs",
      sourceId: styleColor || productId,
      title,
      genre: "スニーカー",
      subGenre: null,
      eventType,
      eventDate,
      eventDateText,
      price: formatYen(p.currentPrice, p.currency),
      url: slug ? `${LAUNCH_URL}/t/${slug}` : LAUNCH_URL,
      imageUrl: typeof p.imageSrc === "string" ? p.imageSrc : null,
    });
  }

  return disambiguateSameTitle(items);
}

/**
 * 同じ回に**まったく同じ商品名**が2つ以上あるとき、品番を付けて区別する。
 *
 * 実測 2026-08-20: 「ナイキ ブレイジー」が2件（IM2523-001＝10/1発売 / IM2523-100＝8/28発売）。
 * SNKRS の商品名にはカラーが入らないので、一覧には**同じ名前・違う日付のカードが2枚**並ぶ。
 * このサイトは「どれがいつ買えるか」を出すのが役目なので、名前で区別が付かないと
 * 日付そのものが読者にとって意味を失う（どちらの日付か分からない）。
 *
 * 付けるのは**品番（styleColor）**。収集元がカラー名を日本語で持っていないので、
 * URLのスラッグ（"blazy-white-and-sail"）から色名を作ると**こちらが訳した言葉**になる。
 * 品番は収集元が持っている識別子そのもので、せどらーが実際に照合に使う値でもある。
 * 衝突したときだけ付ける（毎回付けると、区別の要らない商品名まで長くなる）。
 */
export function disambiguateSameTitle(items: ScrapedItem[]): ScrapedItem[] {
  const count = new Map<string, number>();
  for (const it of items) count.set(it.title, (count.get(it.title) ?? 0) + 1);
  return items.map((it) =>
    (count.get(it.title) ?? 0) > 1 && /^[A-Z0-9-]+$/.test(it.sourceId)
      ? { ...it, title: `${it.title}（${it.sourceId}）` }
      : it
  );
}
