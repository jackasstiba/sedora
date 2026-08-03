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

/** せどり相場の核＝注目賞（A賞・ラストワン賞等）を先に見せるための並べ替え用キー。 */
export function notablePrizeLabels(prizes: PrizeFull[]): PrizeFull[] {
  return prizes.filter((p) => isHotPrize(p.label));
}
