import Link from "next/link";

// 全ページ共通のフッター。免責と新着購読(RSS)をどのページからでも見られるように。
export function SiteFooter() {
  return (
    <footer className="mt-12 border-t border-neutral-200 dark:border-neutral-800">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 text-xs text-neutral-400">
        <p className="mb-2">
          <Link href="/" className="text-rose-600 hover:underline dark:text-rose-400">
            ハツコレ
          </Link>
          {" ・ "}
          <a href="/feed.xml" className="text-rose-600 hover:underline dark:text-rose-400">
            RSSで新着を購読
          </a>
          （Discordやフィードリーダーに新着レア情報を自動で流せます）
        </p>
        <p>
          フィギュア・トレカ・スニーカー・一番くじ・コラボグッズなどの予約・発売・抽選予定を独自に収集・整理して掲載しています。
          予約・購入は各リンク先の公式・販売ページをご確認ください。
        </p>
      </div>
    </footer>
  );
}
