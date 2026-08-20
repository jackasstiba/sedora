// 入手経路タグ（英語版 /en 用）。**裏取りできた (収集元, ホスト) の組だけ**を
// 「Online (JP)」＝日本の公式オンラインストア/オンライン抽選で注文・応募する商品、と表示する。
//
// 規約（[[Projects/sedori_radar_en]] / UIラベルは裏取り済みのみ約束）:
//  ・約束するのは「導線の性質（オンラインで注文/応募するページである）」だけ。
//    **今も買える/応募できる（可用性）や、海外から買える、は約束しない**（確認できないため）。
//  ・表に無い組はタグを出さない。「店頭のみ」の断定も v1 ではしない（裏取りが揃っていない）。
//  ・ソース名だけで決め打ちしない（画像の教訓と同じ）。ホストとの**組**で判定する。
//
// 裏取りの記録（2026-08-20・各1ページを実際に開いて確認）:
//  ・chiikawamarket.jp   … 公式オンラインストアの商品ページ（受注期間つきのオンライン注文）
//  ・takaratomymall.jp   … サイト自身が「おもちゃ・グッズの通販 タカラトミーモール【公式】」と名乗る公式モール
//  ・p-bandai.jp         … プレミアムバンダイ（outbound.ts の OFFICIAL_STORE_LABELS で裏取り済みの公式通販）
//  ・store.medicomtoy.co.jp … MEDICOM TOY OFFICIAL STORE（オンライン注文・一般抽選の受付ページを確認）
//  ・mct.tokyo           … 301 で store.medicomtoy.co.jp へ恒久リダイレクト（同一ストア）
//  ・billys-tokyo.net    … BILLY'S ENT 公式通販の商品/LAUNCHページ
//  ・raffle-kuji.jp      … オンラインくじプラットフォーム（オンラインで引き、賞品が配送される）
//  ・nike.com            … Nike SNKRS の launch ページ（オンラインの発売/抽選エントリー）

const VERIFIED_ONLINE_PAIRS: Record<string, ReadonlySet<string>> = {
  chiikawa_market: new Set(["chiikawamarket.jp"]),
  takaratomy_mall: new Set(["takaratomymall.jp"]),
  figisland_pb: new Set(["p-bandai.jp"]),
  medicom_toy: new Set(["store.medicomtoy.co.jp", "mct.tokyo"]),
  billys: new Set(["billys-tokyo.net"]),
  raffle_kuji: new Set(["raffle-kuji.jp"]),
  nike_snkrs: new Set(["nike.com"]),
};

/** カードに出すタグの文字列。audit:page が /en の描画結果と突き合わせるので、
 *  変えるなら scripts/auditRendered.ts 側も一緒に変える。 */
export const ONLINE_TAG_EN = "🛒 Online (JP)";

function hostOf(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    return new URL(u).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/**
 * この行の商品ページ/応募ページが「日本の公式オンラインストア/オンライン抽選」だと
 * 裏取りできているか。url / officialUrl のどちらかが裏取り済みの組に当たれば true。
 */
export function isOnlineItem(row: {
  source: string;
  url: string | null;
  officialUrl?: string | null;
}): boolean {
  const hosts = VERIFIED_ONLINE_PAIRS[row.source];
  if (!hosts) return false;
  const h1 = hostOf(row.url);
  const h2 = hostOf(row.officialUrl);
  return (h1 !== null && hosts.has(h1)) || (h2 !== null && hosts.has(h2));
}
