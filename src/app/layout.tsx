import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: process.env.NEXT_PUBLIC_SITE_URL
    ? new URL(process.env.NEXT_PUBLIC_SITE_URL)
    : undefined,
  title: "レアレーダー | レア・限定品の予約・発売・抽選スケジュール",
  description:
    "フィギュア・トレカ・スニーカー・一番くじ・コラボグッズなど、レア・限定アイテムの予約開始・発売・抽選の予定を日付順に掲載。",
  alternates: {
    types: { "application/rss+xml": "/feed.xml" },
  },
  openGraph: {
    title: "レアレーダー | レア・限定品の予約・発売・抽選スケジュール",
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
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
