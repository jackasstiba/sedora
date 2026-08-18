import { AD_DISCLOSURE } from "@/lib/outbound";

// 広告である旨の表示。ヘッダーの直下＝**ファーストビュー**に全ページ共通で出す
// （ステマ規制／楽天アフィリエイトのガイドライン。文言の根拠は lib/outbound.ts）。
// 目立たせすぎず、しかし読める大きさ・色で出す（視認しづらい色・極小文字は禁止行為）。
export function AdDisclosure() {
  return (
    <p className="border-b border-neutral-200 bg-neutral-50 px-4 py-1.5 text-center text-xs text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
      {AD_DISCLOSURE}
    </p>
  );
}
