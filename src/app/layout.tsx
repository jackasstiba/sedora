import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "せどりレーダー | レア・限定品の予約・発売情報まとめ",
  description:
    "フィギュア・トレカ・限定グッズなど、せどり・転売で狙えるレア/限定商品の予約開始・発売・抽選情報を各所から自動収集してまとめて掲載。",
  openGraph: {
    title: "せどりレーダー | レア・限定品の予約・発売情報まとめ",
    description:
      "フィギュア・トレカ・スニーカー・限定グッズの予約開始・発売・抽選情報をまとめて自動収集。せどり・転売の仕入れリサーチに。",
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
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
