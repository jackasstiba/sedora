// 一番くじの各賞ラインナップは scraper 側で highlights 文字列
// 「各賞ラインナップ：A賞 … ／ B賞 … ／ …（全N種）」として保存している。
// 商品詳細ページでこれをリスト（賞ラベル＋賞品名）に展開するための純関数。
// マーカーで始まらない highlights（コラボ由来の要約等）は null を返す＝従来表示のまま。

const KUJI_MARKER = "各賞ラインナップ：";

export type PrizeRow = { label: string; name: string };

export function parseKujiLineup(highlights: string | null | undefined): PrizeRow[] | null {
  if (!highlights || !highlights.startsWith(KUJI_MARKER)) return null;
  const body = highlights.slice(KUJI_MARKER.length).replace(/（全\d+種）\s*$/, "");
  const rows = body
    .split("／")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((e): PrizeRow => {
      const m = e.match(/^(.+?賞)\s+(.+)$/);
      return m ? { label: m[1].trim(), name: m[2].trim() } : { label: e, name: "" };
    });
  return rows.length ? rows : null;
}

// せどり視点で相場が付きやすい注目賞（A賞・ラストワン賞・ダブルチャンス等）を強調表示するか判定。
export function isHotPrize(label: string): boolean {
  return label === "A賞" || label.includes("ラストワン") || label.includes("ダブルチャンス");
}

// ── 構造化された各等賞（prizes JSON列） ──────────────────────────────────
// 賞画像ギャラリー＋賞ごとの二次相場（駿河屋バラ売り）を商品詳細で表示するための型。
// scraper は {label,name,image} を、相場スクリプトが resale* を後付けする。
export type PrizeFull = {
  label: string;
  name: string;
  image: string | null;
  // 収集元の詳細ページが賞ごとに書いている仕様（src/scrapers/ichibanKujiEnrich.ts の prizeSpec）。
  // **書いてある賞にだけ入る。** 無い賞を 0/false で埋めない（画面が「選べません」と断定する）。
  variants?: number; // 「■全10種」の N
  choosable?: boolean; // 「（選べる）」と書いてあるか（全N種の行を読めた賞だけ true/false）
  size?: string; // 「■サイズ：約4.5cm」の右側。収集元の文言のまま
  resalePrice?: number; // 二次相場（円）
  resaleText?: string; // 表示用（例: "中古 ¥15,500"）
  resaleUrl?: string; // 相場元の商品ページ
  resaleSource?: string; // "surugaya" など
};

/** Item.prizes（JSON配列文字列）を安全にパースする。壊れていれば null。 */
export function parsePrizesJson(json: string | null | undefined): PrizeFull[] | null {
  if (!json) return null;
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return arr
      .filter((p) => p && typeof p.label === "string")
      .map(
        (p): PrizeFull => ({
          label: p.label,
          name: typeof p.name === "string" ? p.name : "",
          image: typeof p.image === "string" ? p.image : null,
          // 数値・真偽値として書かれているものだけ通す（"10" のような文字列は採らない＝
          // 型が違うものを読み替えると、壊れたJSONを黙って正しいことにしてしまう）。
          variants: typeof p.variants === "number" && p.variants > 0 ? p.variants : undefined,
          choosable: typeof p.choosable === "boolean" ? p.choosable : undefined,
          size: typeof p.size === "string" && p.size.trim() ? p.size : undefined,
          resalePrice: typeof p.resalePrice === "number" ? p.resalePrice : undefined,
          resaleText: typeof p.resaleText === "string" ? p.resaleText : undefined,
          resaleUrl: typeof p.resaleUrl === "string" ? p.resaleUrl : undefined,
          resaleSource: typeof p.resaleSource === "string" ? p.resaleSource : undefined,
        })
      );
  } catch {
    return null;
  }
}

/**
 * 再スクレイプした prizes に、既存行の**後付け情報（二次相場）だけ**を引き継ぐ。
 *
 * scraper が返す prizes は {label,name,image} だけなので、そのまま上書きすると
 * `npm run scrape:kuji:prices` が付けた相場が**毎回の巡回で消える**。実測: 相場を付けた
 * 直後に別件で scrape を回しただけで、67件すべて resalePrice が 0件になっていた。
 * 画像の null 上書き対策（scrape.ts の `imageUrl ?? undefined`）と同じ問題が、
 * JSON の中身という**列単位では守れない場所**で起きていた。
 *
 * 賞ラベルで突合する。賞の構成が変わった（ラベルが消えた）場合はその相場を捨てる＝
 * 別の賞に付け替えない（間違った商品の相場を出すより、出さない方が正しい）。
 */
export function mergePrizeEnrichment(
  existingJson: string | null | undefined,
  freshJson: string | null | undefined
): string | null | undefined {
  if (!freshJson) return freshJson;
  const prev = parsePrizesJson(existingJson);
  const next = parsePrizesJson(freshJson);
  if (!prev || !next) return freshJson;
  const byLabel = new Map(prev.map((p) => [p.label, p]));
  let carried = 0;
  const merged = next.map((p) => {
    const old = byLabel.get(p.label);
    if (!old || old.resalePrice == null) return p;
    carried++;
    return {
      ...p,
      resalePrice: old.resalePrice,
      resaleText: old.resaleText,
      resaleUrl: old.resaleUrl,
      resaleSource: old.resaleSource,
    };
  });
  return carried ? JSON.stringify(merged) : freshJson;
}

/** せどり相場の核＝注目賞（A賞・ラストワン賞等）を先に見せるための並べ替え用キー。 */
export function notablePrizeLabels(prizes: PrizeFull[]): PrizeFull[] {
  return prizes.filter((p) => isHotPrize(p.label));
}
