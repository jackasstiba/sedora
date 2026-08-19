/**
 * 「その画像URLはもう画像を返さない」の**唯一の定義**（純関数・prisma非依存）。
 *
 * なぜ要るか（2026-08-19 実測）: 画像を自ドメイン経由（`/i/<商品ID>`）にしてから、
 * 取得に失敗した画像は**透明1×1**として 200 で配られる。つまりブラウザから見ると
 * 「正常な画像」で、カードには**ただの空白**が出る（商品名を大きく出す NoImage タイルにも
 * ならない）。表示中2,029枚を1枚ずつ取りに行って測ったところ3枚が 404 だった＝
 * **画面を見ても、HTMLを見ても、audit でも気付けない型**。
 *
 * だから「配るのをやめる条件」と「DBから消す条件」を1つの関数にして、
 * 画像プロキシ（src/app/i/[id]/route.ts）と掃除（scripts/pruneDeadImages.ts）の両方が
 * これを呼ぶ。片方だけ直すと「空白は出るのに掃除されない」状態が戻る。
 */

export type ImageProbe = {
  /** HTTPステータス。ネットワークごと失敗したら null。 */
  status: number | null;
  contentType: string | null;
  /** 本文のバイト数。測っていなければ null。 */
  bytes: number | null;
};

/**
 * - `ok`      … 画像として配ってよい
 * - `dead`    … **恒久的に**画像ではない（消してよい）
 * - `unknown` … 一時的な失敗かもしれない（配らないが、**消してはいけない**）
 */
export type ImageVerdict = "ok" | "dead" | "unknown";

export function imageVerdict(p: ImageProbe): ImageVerdict {
  // 接続できない・時間切れは相手の一時障害かもしれない。消すと二度と戻らないので触らない。
  if (p.status === null) return "unknown";
  // 5xx も相手側の一時障害。
  if (p.status >= 500) return "unknown";
  // 4xx は「そのURLに画像は無い」。403（ホットリンク拒否）も**このサーバからは永久に取れない**＝
  // 画面には空白しか出ないので、消して NoImage タイルに落とす方が正しい。
  if (p.status >= 400) return "dead";
  if (p.status < 200 || p.status >= 300) return "unknown";
  // 200 で HTML やログインページが返る＝画像は既に無い（URLだけ生きている）。
  if (!p.contentType || !p.contentType.toLowerCase().startsWith("image/")) return "dead";
  if (p.bytes !== null && p.bytes === 0) return "dead";
  return "ok";
}
