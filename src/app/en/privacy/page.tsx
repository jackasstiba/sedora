import type { Metadata } from "next";
import Link from "next/link";
import { AD_DISCLOSURE_EN } from "@/lib/outbound";

// 英語版のプライバシーポリシー・免責事項（/en/privacy）。
//
// **日本語版（(ja)/privacy/page.tsx）と同じ事実だけを英語で言う。** 新しい約束を足さない。
// 実装を変えたら日英**両方**を直す（片方だけ直すと、どちらかが虚偽になる）。
// FTC向けの開示（アフィリエイトの明示）と、GDPR/CCPA文脈での説明（Cookie不使用・
// 個人データ不収集・識別子なし）はこのページが受け持つ。Cookieを一切使わないので
// 同意バナーは置かない（置くものが無い）。
//
// 免責の一文に "reselling" を含むが、これは「推奨しない」と言うために語そのものが要る
// 例外（日本語版の「投機や高額転売を推奨するものではありません」と同じ扱い。
// scripts/auditSelftest.ts の ALLOWED_FORBIDDEN_PHRASES に登録済み）。

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "";

/** X（旧Twitter）の公式アカウント（日本語版と同一）。 */
const X_HANDLE = "hatsukore_com";

/** 最終改定日。文面を直したらここも直す。 */
const UPDATED_AT = "August 20, 2026";

const DESCRIPTION =
  "Hatsukore privacy policy and disclaimer: how analytics are handled, use of affiliate programs, and the accuracy of listed information.";

export const metadata: Metadata = {
  title: "Privacy Policy & Disclaimer | Hatsukore",
  description: DESCRIPTION,
  alternates: SITE
    ? {
        canonical: `${SITE}/en/privacy`,
        languages: { ja: `${SITE}/privacy`, en: `${SITE}/en/privacy`, "x-default": `${SITE}/privacy` },
      }
    : undefined,
  openGraph: { title: "Privacy Policy & Disclaimer | Hatsukore", description: DESCRIPTION, type: "website" },
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-50">{title}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPageEn() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
      <nav className="mb-2 text-xs text-neutral-600 dark:text-neutral-400">
        <Link href="/en" className="hover:underline">
          Hatsukore
        </Link>
        {" / Privacy Policy & Disclaimer"}
      </nav>

      <header>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
          Privacy Policy & Disclaimer
        </h1>
        <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
          Last updated: {UPDATED_AT} ·{" "}
          <Link href="/privacy" className="text-rose-600 hover:underline dark:text-rose-400" lang="ja">
            日本語版
          </Link>
        </p>
      </header>

      <Section title="About this site">
        <p>
          Hatsukore is an information site that collects and organizes upcoming pre-order,
          release and lottery schedules for figures, trading cards, sneakers, Ichiban Kuji and
          collaboration goods in Japan. We do not sell, take orders for, or ship any products;
          every purchase or entry takes place on the linked seller&apos;s own site.
        </p>
      </Section>

      <Section title="Analytics">
        <p>
          We use Vercel Web Analytics to understand how the site is used. It does{" "}
          <strong>not use cookies</strong> and only handles aggregate statistics such as pages
          viewed, referrers, country and device type. We never collect or store information that
          identifies you personally, such as your name, email address or phone number.
        </p>
        <p>
          We also record basic usage events ourselves to improve the site: page views, search
          keywords typed into the site search, genre selections and outbound link clicks. These
          records use no cookies and contain no IP addresses, no personal information and no
          per-visitor identifiers.
        </p>
        <p>
          The site has no account registration, no login and no contact forms, so there is no
          mechanism that accepts personal information from visitors. Because we set no cookies,
          there is no cookie consent to ask for.
        </p>
      </Section>

      <Section title="Affiliate programs">
        <p>{AD_DISCLOSURE_EN}</p>
        <p>
          Some links on product pages (such as &quot;楽天で探す&quot; / Rakuten search links on
          the Japanese pages) are affiliate advertising links. If you buy something after
          following such a link, this site may receive a referral fee. Any cookies involved
          belong to the destination site (Rakuten, Inc.); we never receive your purchase details
          or personal information.
        </p>
        <p>
          Referral fees never influence which items we list or how they are ranked.
        </p>
      </Section>

      <Section title="Third-party display ads">
        <p>
          We currently serve no third-party display advertising (such as Google AdSense). If
          that changes, this page will be updated to describe the ad provider&apos;s use of
          cookies and how to opt out.
        </p>
      </Section>

      <Section title="Listed information & disclaimer">
        <p>
          Listings are collected and organized from official sites and retailer announcements,
          but we do not guarantee that they are complete, accurate or up to date.{" "}
          <strong>
            Release dates, prices, entry conditions, deadlines and stock availability can change
            without notice.
          </strong>{" "}
          All dates and times on this site are Japan Standard Time (JST). Always check the
          linked official or store page before ordering or entering.
        </p>
        <p>
          We accept no liability for damages arising from the use of information on this site.
          External links are operated under the responsibility of their own site owners, and we
          are not responsible for their content.
        </p>
        {/* 免責の一文。ALLOWED_FORBIDDEN_PHRASES と文字列一致させるため改行で分断しない。 */}
        <p>This site exists to introduce product information and does not encourage speculation or high-priced reselling.</p>
      </Section>

      <Section title="Copyright">
        <p>
          All product names, brand names and images belong to their respective rights holders.
          If you are a rights holder and have concerns about a listing, please contact us below
          and we will review and respond promptly.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          For inquiries, corrections or removal requests, please contact us on X (Twitter):{" "}
          <a
            href={`https://x.com/${X_HANDLE}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-rose-600 hover:underline dark:text-rose-400"
          >
            @{X_HANDLE}
          </a>
          .
        </p>
      </Section>

      <Section title="Changes to this policy">
        <p>
          We may update this policy as needed. Changes take effect when they are published on
          this page.
        </p>
      </Section>
    </main>
  );
}
