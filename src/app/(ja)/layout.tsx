import type { Metadata } from "next";
import { SiteAnalytics } from "@/components/SiteAnalytics";
import { SiteHeader } from "@/components/SiteHeader";
import { AdDisclosure } from "@/components/AdDisclosure";
import { SiteFooter } from "@/components/SiteFooter";
import "../globals.css";

export const metadata: Metadata = {
  metadataBase: process.env.NEXT_PUBLIC_SITE_URL
    ? new URL(process.env.NEXT_PUBLIC_SITE_URL)
    : undefined,
  title: "ハツコレ | レア・限定品の予約・発売・抽選スケジュール",
  description:
    "フィギュア・トレカ・スニーカー・一番くじ・コラボグッズなど、レア・限定アイテムの予約開始・発売・抽選の予定を日付順に掲載。",
  // Google Search Console の所有権確認（meta タグ方式）。
  // 未設定なら meta 自体が出ない（空文字の meta を出すと確認が失敗する）。
  // ⚠ Vercel の環境変数は**ビルド時**に読まれるので、追加したら再デプロイが要る。
  ...(process.env.GOOGLE_SITE_VERIFICATION
    ? { verification: { google: process.env.GOOGLE_SITE_VERIFICATION } }
    : {}),
  alternates: {
    types: { "application/rss+xml": "/feed.xml" },
  },
  openGraph: {
    title: "ハツコレ | レア・限定品の予約・発売・抽選スケジュール",
    description:
      "フィギュア・トレカ・スニーカー・一番くじ・コラボグッズなど、レア・限定アイテムの予約開始・発売・抽選の予定を日付順に掲載。",
    type: "website",
    // og:url が無いと、SNS側が貼られたURL（トラッキング付き等）を正としてしまう。
    // metadataBase があるので相対パスで絶対URLに解決される。
    url: "/",
    siteName: "ハツコレ",
    locale: "ja_JP",
  },
  // og:image 自体は src/app/opengraph-image.png（Nextのfile convention）が自動で付ける。
  // ここで card を summary_large_image にしないと、画像があっても小さい正方形カードのままになる。
  twitter: {
    card: "summary_large_image",
    title: "ハツコレ | レア・限定品の予約・発売・抽選スケジュール",
    description:
      "フィギュア・トレカ・スニーカー・一番くじ・コラボグッズなど、レア・限定アイテムの予約開始・発売・抽選の予定を日付順に掲載。",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <SiteHeader />
        {/* 広告である旨の表示。ヘッダー直下＝どのページでもファーストビューに入る位置に置く
            （下部・フッターへの記載は不可とされている。根拠は lib/outbound.ts の AD_DISCLOSURE）。 */}
        <AdDisclosure />
        {children}
        <SiteFooter />
        <SiteAnalytics />
      </body>
    </html>
  );
}
