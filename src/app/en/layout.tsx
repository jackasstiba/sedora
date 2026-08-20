import type { Metadata } from "next";
import { SiteAnalytics } from "@/components/SiteAnalytics";
import { SiteHeader } from "@/components/SiteHeader";
import { AdDisclosure } from "@/components/AdDisclosure";
import { SiteFooter } from "@/components/SiteFooter";
import "../globals.css";

// 英語版（/en）のルートレイアウト。app/layout.tsx を (ja) グループへ移したので、
// この階層に layout を置くと /en 配下だけの**もう1つのルートレイアウト**になる
// （<html lang="en"> を正しく出すための構成。JAとENの行き来はフルページロードになるが、
// 言語切替は稀な操作なので問題ない）。
export const metadata: Metadata = {
  metadataBase: process.env.NEXT_PUBLIC_SITE_URL
    ? new URL(process.env.NEXT_PUBLIC_SITE_URL)
    : undefined,
  title: "Hatsukore | Japan pre-order, release & lottery schedule",
  description:
    "Upcoming Japanese pre-orders, releases and lottery drops for figures, trading cards, sneakers, Ichiban Kuji and collab goods — sorted by date, in English.",
  openGraph: {
    title: "Hatsukore | Japan pre-order, release & lottery schedule",
    description:
      "Upcoming Japanese pre-orders, releases and lottery drops for figures, trading cards, sneakers, Ichiban Kuji and collab goods — sorted by date, in English.",
    type: "website",
    url: "/en",
    siteName: "Hatsukore",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Hatsukore | Japan pre-order, release & lottery schedule",
    description:
      "Upcoming Japanese pre-orders, releases and lottery drops for figures, trading cards, sneakers, Ichiban Kuji and collab goods — sorted by date, in English.",
  },
};

export default function EnRootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <SiteHeader locale="en" />
        {/* 広告表示（英語）。実際に /en に出ているかは audit:page の checkAdDisclosure が見る。 */}
        <AdDisclosure locale="en" />
        {children}
        <SiteFooter locale="en" />
        <SiteAnalytics />
      </body>
    </html>
  );
}
