import { AD_DISCLOSURE, AD_DISCLOSURE_EN } from "@/lib/outbound";
import type { Locale } from "@/lib/i18n";

// 広告である旨の表示。ヘッダーの直下＝**ファーストビュー**に全ページ共通で出す
// （ステマ規制／楽天アフィリエイトのガイドライン。文言の根拠は lib/outbound.ts）。
// ⚠ ここより下（フッター等）へは移せない: 楽天のガイドラインはファーストビュー表示を
// 必須とし、ページ下部のみの記載を禁止行為に挙げている（2026-08-21 確認）。
// 「目立たなくする」は場所ではなく見た目で行う＝全幅の帯（背景+ボーダー+中央寄せ）を
// やめて右寄せの小さな一行にする。ただし極小文字・視認しづらい色は禁止行為なので、
// 文字サイズ（text-xs）と AA を満たす色はここが下限（audit の text_color 検査の対象）。
export function AdDisclosure({ locale = "ja" }: { locale?: Locale } = {}) {
  return (
    <p className="px-4 py-1 text-right text-xs text-neutral-600 dark:text-neutral-400">
      {locale === "en" ? AD_DISCLOSURE_EN : AD_DISCLOSURE}
    </p>
  );
}
