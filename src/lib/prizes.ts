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
