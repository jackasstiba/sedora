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
export type OutboundKind =
  | "official"
  | "source"
  | "official_secondary"
  | "rakuten"
  | "market";

type Props = {
  href: string;
  kind: OutboundKind;
  source: string;
  itemId: number;
  className?: string;
  children: React.ReactNode;
};

export function OutboundLink({ href, kind, source, itemId, className, children }: Props) {
  return (
    <a
      href={href}
      target="_blank"
      rel="nofollow noopener noreferrer"
      className={className}
      onClick={() => {
        // itemId は数値だと by=eventData 集計で扱いにくいので文字列で送る。
        track("outbound_click", { kind, source, itemId: String(itemId) });
        // 遷移でキャンセルされないよう logEvent は sendBeacon を優先する。
        logEvent("outbound_click", kind, { source, itemId });
      }}
    >
      {children}
    </a>
  );
}
