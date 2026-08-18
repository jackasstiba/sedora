// 商品画像を「自分のドメインから配る」ためのURLの作り方（prisma 非依存の純関数）。
//
// なぜ要るか（2026-08-18 実測）:
// 表示中の画像 1,834枚のうち **784枚（43%）** が collabo-cafe.com / ota-goods.info /
// figisland.net / kore-tore.com / cdn.snkrdunk.com から直リンクされていた。これは
// **収集元を1つも出さない**という方針（サイト名も情報元リンクもXのハンドルも出さない）に
// 正面から反する: 画像のホスト名を見るだけで巡回先の一覧が復元できてしまう。
// おまけに他所のサーバの帯域を毎表示ぶん借りている（ホットリンク）。
//
// 直し方は「画像を消す」ではなく「自分のドメインを通す」。HTMLに出るURLは
// `/i/<商品ID>?v=<版>` だけになり、元URLはサーバの中だけに残る。
//
// **ホストで場合分けしない。** 「この収集元だけ隠す」と手書きの一覧を作ると、
// 新しい収集元を足した日に必ず漏れる（同じ型の穴を画像の付け方で一度踏んでいる）。
// 外部画像は全部通す、が唯一の規則。

/** プロキシのパス接頭辞。検査側もこの定数を見る。 */
export const IMAGE_PROXY_PREFIX = "/i/";

/**
 * 画像URLから短い「版」を作る（FNV-1a・36進）。
 *
 * これが無いと `/i/123` は永久キャッシュにできない（後から画像が差し替わっても古いまま出る）。
 * 版が変われば別URLになるので、`immutable` で1年キャッシュしてよくなる＝
 * 収集元へ取りに行くのは実質1回だけになり、借りている帯域もほぼ返せる。
 */
export function imageVersion(url: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/**
 * 画面に出す画像URL。`imageUrl` が無ければ null（呼び出し側は NoImage を出す）。
 * `prizeIndex` を渡すと、その商品の各賞ギャラリーの画像を指す。
 */
export function proxiedImageUrl(
  itemId: number,
  imageUrl: string | null | undefined,
  prizeIndex?: number
): string | null {
  if (!imageUrl) return null;
  const v = `v=${imageVersion(imageUrl)}`;
  const p = prizeIndex === undefined ? "" : `p=${prizeIndex}&`;
  return `${IMAGE_PROXY_PREFIX}${itemId}?${p}${v}`;
}

/** OGP・構造化データ用の絶対URL（SNSやGoogleは相対パスを解決しない）。 */
export function absoluteImageUrl(
  site: string,
  itemId: number,
  imageUrl: string | null | undefined
): string | undefined {
  const rel = proxiedImageUrl(itemId, imageUrl);
  if (!rel) return undefined;
  return site ? `${site}${rel}` : undefined;
}
