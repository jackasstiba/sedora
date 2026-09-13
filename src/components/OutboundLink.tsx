"use client";

import { track } from "@vercel/analytics";
import { logEvent } from "@/lib/logEvent";

// 外部リンク（購入導線・情報元・相場）のクリックを計測するための薄いラッパー。
// ハツコレの収益はアフィリエイト＝「外部の購入/公式ページへ送客できたか」が唯一の成果指標。
// 一覧・詳細のカードは自サイト内リンク(=PVで拾える)だが、外部への送客だけはPVに出ないため
// ここでカスタムイベント outbound_click を送る。kind で導線の種類を区別する。
//   official          … item.url が公式・商品ページ（そのまま買える）
//   source            … item.url がまとめ/告知（情報元。買える場所ではない）
//   official_secondary… コラボ記事から辿った一次情報(公式キャンペーン/ストア)
//   rakuten           … 商品名で楽天検索（将来アフィリンクに差し替える本命導線）
//   market            … 相場ソース(駿河屋)への遷移
//   proxy             … 代行(Buyee等)への送客。**英語圏の読者にとっての実際の購入手段**で、
//                       楽天(国内発送のみ)では買えない層がここを踏む。どの代行が押されるかは
//                       detail で区別する（アフィリ提携を申し込む先を実測で決めるため）
export type OutboundKind =
  | "official"
  | "source"
  | "official_secondary"
  | "rakuten"
  | "market"
  | "proxy";

// source は**符号**（src/lib/sourceCode.ts）で渡すこと。ここはクライアント部品なので、
// 渡した値はそのまま配信物に載る＝収集元の内部名を書くと非公開方針が破れる。
// source / itemId は**商品に紐づく導線でだけ**渡す。/en/how-to-buy のような固定ガイドの
// リンクにはそもそも商品が無いので、どちらも省略できる（省略時は "-" で記録し、
// 「商品ページから押された」と「ガイドから押された」を後から取り違えないようにする）。
type Props = {
  href: string;
  kind: OutboundKind;
  source?: string;
  itemId?: number;
  /** 同じ kind の中での行き先の区別（例: 代行の "buyee" / "zenmarket"）。収集元は入れない。 */
  detail?: string;
  className?: string;
  children: React.ReactNode;
};

export function OutboundLink({ href, kind, source, itemId, detail, className, children }: Props) {
  return (
    <a
      href={href}
      target="_blank"
      // アフィリリンクには rel="sponsored"（Googleが広告・提携リンクに指定している値）。
      // 他の外部リンクは従来どおり nofollow。どちらも noopener noreferrer は付ける。
      // proxy が nofollow なのは**今はまだ素リンクだから**。Buyee の計測リンク（Indoleads・
      // 承認待ち）に差し替えたら、ここも sponsored 側に移すこと（差し替えとセット）。
      rel={`${kind === "rakuten" ? "sponsored" : "nofollow"} noopener noreferrer`}
      className={className}
      onClick={() => {
        // itemId は数値だと by=eventData 集計で扱いにくいので文字列で送る。
        track("outbound_click", {
          kind,
          source: source ?? "-",
          itemId: itemId == null ? "-" : String(itemId),
          ...(detail ? { detail } : {}),
        });
        // 遷移でキャンセルされないよう logEvent は sendBeacon を優先する。
        logEvent("outbound_click", kind, { source, itemId, detail });
      }}
    >
      {children}
    </a>
  );
}
