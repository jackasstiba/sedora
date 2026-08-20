import Link from "next/link";
import type { Locale } from "@/lib/i18n";

// 全ページ共通のフッター。免責と新着購読(RSS)をどのページからでも見られるように。
export function SiteFooter({ locale = "ja" }: { locale?: Locale } = {}) {
  if (locale === "en") {
    return (
      <footer className="mt-12 border-t border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 text-xs text-neutral-600 dark:text-neutral-400">
          <p className="mb-2">
            <Link href="/en" className="text-rose-600 hover:underline dark:text-rose-400">
              Hatsukore
            </Link>
            {" · "}
            <Link href="/" className="text-rose-600 hover:underline dark:text-rose-400" lang="ja">
              日本語版
            </Link>
            {" · "}
            <Link href="/en/privacy" className="text-rose-600 hover:underline dark:text-rose-400">
              Privacy policy & disclaimer
            </Link>
          </p>
          <p>
            Upcoming Japanese pre-orders, releases and lottery drops for figures, trading cards,
            sneakers, Ichiban Kuji and collab goods, collected and organized from public sources.
            All dates and deadlines are Japan time (JST). Please confirm details on each official
            or store page before ordering.
          </p>
        </div>
      </footer>
    );
  }
  return (
    <footer className="mt-12 border-t border-neutral-200 dark:border-neutral-800">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 text-xs text-neutral-600 dark:text-neutral-400">
        <p className="mb-2">
          <Link href="/" className="text-rose-600 hover:underline dark:text-rose-400">
            ハツコレ
          </Link>
          {" ・ "}
          <a href="/feed.xml" className="text-rose-600 hover:underline dark:text-rose-400">
            RSSで新着を購読
          </a>
          （Discordやフィードリーダーに新着レア情報を自動で流せます）
          {" ・ "}
          {/* アフィリエイトを使っている以上、方針を書いた面へどのページからでも辿れるようにする。 */}
          <Link href="/privacy" className="text-rose-600 hover:underline dark:text-rose-400">
            プライバシーポリシー・免責事項
          </Link>
        </p>
        <p>
          フィギュア・トレカ・スニーカー・一番くじ・コラボグッズなどの予約・発売・抽選予定を独自に収集・整理して掲載しています。
          予約・購入は各リンク先の公式・販売ページをご確認ください。
        </p>
      </div>
    </footer>
  );
}
