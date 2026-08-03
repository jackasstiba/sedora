import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: process.env.NEXT_PUBLIC_SITE_URL
    ? new URL(process.env.NEXT_PUBLIC_SITE_URL)
    : undefined,
  title: "ハツコレ | レア・限定品の予約・発売・抽選スケジュール",
  description:
    "フィギュア・トレカ・スニーカー・一番くじ・コラボグッズなど、レア・限定アイテムの予約開始・発売・抽選の予定を日付順に掲載。",
  alternates: {
    types: { "application/rss+xml": "/feed.xml" },
  },
  openGraph: {
    title: "ハツコレ | レア・限定品の予約・発売・抽選スケジュール",
    description:
      "フィギュア・トレカ・スニーカー・一番くじ・コラボグッズなど、レア・限定アイテムの予約開始・発売・抽選の予定を日付順に掲載。",
    type: "website",
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
        {children}
        <SiteFooter />
        <Analytics />
      </body>
    </html>
  );
}
