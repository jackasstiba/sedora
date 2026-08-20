import type { Metadata } from "next";
import Link from "next/link";
import { AD_DISCLOSURE } from "@/lib/outbound";

// プライバシーポリシー・免責事項。
//
// なぜ静的な1枚を置くか:
//  ①アフィリエイト（楽天）を実際に使っている以上、何を計測し何を計測していないかを
//    書いた面が要る。②将来ディスプレイ広告を審査に出すときの前提（プライバシーポリシー・
//    運営者情報・連絡手段）を先に満たしておく。③初訪問者に対する信頼の担保。
//
// ⚠ ここは「今この瞬間の実装」と一致していなければ意味がない。実装を変えたらここも直す:
//  - アクセス解析を足す/替える → 「アクセス解析について」
//  - アフィリエイトを楽天以外に広げる → 「アフィリエイトプログラムについて」
//  - ディスプレイ広告（AdSense等）を入れる → 「広告配信について」を書き換える
//    （現在は「利用していない」と明記している。入れたまま放置すると虚偽になる）

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "";

/**
 * 問い合わせ先メールアドレス。**空なら X のみを案内する。**
 * 個人のメールをそのまま晒すかは本人が決めることなので、既定は空にしてある。
 */
const CONTACT_EMAIL = "";

/** X（旧Twitter）の公式アカウント。 */
const X_HANDLE = "hatsukore_com";

/** 最終改定日。文面を直したらここも直す（「いつ時点の約束か」が読み手には要る）。 */
const UPDATED_AT = "2026年8月20日";

const DESCRIPTION =
  "ハツコレのプライバシーポリシー・免責事項。アクセス解析の扱い、アフィリエイトプログラムの利用、掲載情報の正確性についての方針を記載しています。";

export const metadata: Metadata = {
  title: "プライバシーポリシー・免責事項 | ハツコレ",
  description: DESCRIPTION,
  alternates: SITE
    ? {
        canonical: `${SITE}/privacy`,
        // 英語版（/en/privacy）と双方向＋自己参照（hreflangの仕様）。
        languages: { ja: `${SITE}/privacy`, en: `${SITE}/en/privacy`, "x-default": `${SITE}/privacy` },
      }
    : undefined,
  openGraph: { title: "プライバシーポリシー・免責事項 | ハツコレ", description: DESCRIPTION, type: "website" },
};

/** 節の見出しと本文。文面の見た目を1箇所に閉じ込める。 */
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

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
      <nav className="mb-2 text-xs text-neutral-600 dark:text-neutral-400">
        <Link href="/" className="hover:underline">
          ハツコレ
        </Link>
        {" ／ プライバシーポリシー・免責事項"}
      </nav>

      <header>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
          プライバシーポリシー・免責事項
        </h1>
        <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">最終改定日：{UPDATED_AT}</p>
      </header>

      <Section title="運営について">
        <p>
          当サイト「ハツコレ」は、フィギュア・トレカ・スニーカー・一番くじ・コラボグッズなどの
          予約・発売・抽選の予定を収集・整理して掲載する情報サイトです。商品の販売・受注・発送は
          行っておらず、購入手続きはすべて各リンク先の販売事業者との取引になります。
        </p>
      </Section>

      <Section title="アクセス解析について">
        <p>
          当サイトは、閲覧状況の把握のために Vercel 社のアクセス解析（Vercel Web Analytics）を
          利用しています。この解析は<strong>Cookie を使用せず</strong>、閲覧されたページ・参照元・
          国・端末の種別といった統計情報のみを扱います。氏名・メールアドレス・電話番号など、
          個人を特定できる情報を当サイトが取得・保存することはありません。
        </p>
        <p>
          また、サイトの改善のために、ページの閲覧・サイト内検索の検索語・ジャンル選択・
          外部リンクのクリックといった操作イベントを当サイト自身でも記録しています。
          これらの記録に Cookie は使用せず、IPアドレス・氏名など個人を特定できる情報や
          閲覧者ごとの識別子は含まれません。
        </p>
        <p>
          当サイトは会員登録・ログイン・お問い合わせフォームを設けておらず、閲覧者から
          個人情報の入力を受け付ける仕組みを持っていません。
        </p>
      </Section>

      <Section title="アフィリエイトプログラムについて">
        <p>{AD_DISCLOSURE}</p>
        <p>
          商品ページに設置している「楽天で探す」等のリンクは、楽天アフィリエイトによる広告リンクです。
          リンクを経由して商品が購入された場合、当サイトに紹介料が支払われることがあります。
          この際に利用されるCookie等は遷移先（楽天株式会社）のもので、当サイトが購入内容や
          お客様の個人情報を受け取ることはありません。
        </p>
        <p>
          紹介料の有無によって掲載する商品を選別したり、掲載順を操作したりすることはありません。
        </p>
      </Section>

      <Section title="広告配信について">
        {/* 現状の事実。AdSense等を入れたらこの節を「第三者配信の広告事業者がCookieを使用し、
            パーソナライズ広告を配信する。無効化は Google の広告設定から行える」旨に書き換える。 */}
        <p>
          当サイトは現在、第三者配信によるディスプレイ広告（Google アドセンス等）の掲載は
          行っておりません。今後掲載する場合は、本ページにその旨と、広告事業者による
          Cookie の利用および無効化の方法を記載します。
        </p>
      </Section>

      <Section title="掲載情報と免責事項">
        <p>
          当サイトは、公式サイト・各販売店の告知をもとに情報を収集・整理して掲載していますが、
          内容の完全性・正確性・最新性を保証するものではありません。
          <strong>発売日・価格・応募条件・締切・在庫状況は予告なく変更されることがあります。</strong>
          ご購入・ご応募の前に、必ず各リンク先の公式・販売ページで最新の情報をご確認ください。
        </p>
        <p>
          当サイトの情報を利用したことによって生じた損害について、当サイトは一切の責任を負いかねます。
          また、外部サイトへのリンクは各サイトの管理者の責任において運営されており、
          リンク先の内容について当サイトは責任を負いません。
        </p>
        <p>
          当サイトは商品情報の紹介を目的としており、投機や高額転売を推奨するものではありません。
        </p>
      </Section>

      <Section title="著作権について">
        <p>
          掲載している商品名・ブランド名・画像等の著作権および商標権は、各権利者に帰属します。
          権利者の方で掲載内容に問題がある場合は、下記の連絡先よりご連絡ください。
          確認のうえ速やかに対応いたします。
        </p>
      </Section>

      <Section title="お問い合わせ">
        <p>
          当サイトに関するお問い合わせ・掲載内容の訂正依頼・削除依頼は、
          X（旧Twitter）の{" "}
          <a
            href={`https://x.com/${X_HANDLE}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-rose-600 hover:underline dark:text-rose-400"
          >
            @{X_HANDLE}
          </a>{" "}
          までご連絡ください。
          {CONTACT_EMAIL ? `メールの場合は ${CONTACT_EMAIL} 宛にお願いいたします。` : null}
        </p>
      </Section>

      <Section title="本ポリシーの変更">
        <p>
          当サイトは、必要に応じて本ポリシーの内容を変更することがあります。
          変更後の内容は本ページに掲載した時点から効力を生じるものとします。
        </p>
      </Section>
    </main>
  );
}
