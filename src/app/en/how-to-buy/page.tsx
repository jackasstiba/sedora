import type { Metadata } from "next";
import Link from "next/link";

// 「日本からどう買うか」の固定ガイド（英語版のコア導線）。データを読まない静的ページ。
//
// 書き方の規約（[[Projects/sedori_radar_en]] / UIラベルは裏取り済みのみ約束）:
//  ・「買える」と断定しない。代行・ショップの可否は各サービス側で決まるので、
//    仕組みと確認先を示すに留める（"usually" / "many" / "check each page"）。
//  ・費用は構造（内訳）だけを書き、料率・金額の数字は書かない（裏取りできても翌週腐る）。
//  ・立ち位置の語彙（resell/resale/scalp/profit 等）は使わない＝auditSelftest の
//    表示層スキャンがこのファイルも自動で見る。
//  ・代行サービスへのリンクは現状**素リンク**。Buyee の計測リンク（Indoleads・承認待ち）が
//    取れたら、リンクを差し替え＋リンク近傍にアフィリ開示の一文を追加する（FTC・§5設計）。
export const metadata: Metadata = {
  title: "How to buy from Japan | Hatsukore",
  description:
    "How overseas collectors order Japanese pre-orders, kuji and limited goods: proxy shopping services, what they cost, and what can (and cannot) be bought from outside Japan.",
  alternates: { canonical: "/en/how-to-buy" },
};

/** 目次つきの節見出し。 */
function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mb-3 mt-10 scroll-mt-16 text-lg font-bold text-neutral-900 dark:text-neutral-50">
      {children}
    </h2>
  );
}

export default function HowToBuyPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
      <nav className="mb-4 text-xs text-neutral-600 dark:text-neutral-400">
        <Link href="/en" className="hover:underline">
          Hatsukore
        </Link>
        {" / How to buy from Japan"}
      </nav>

      <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
        How to buy from Japan
      </h1>
      <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">
        Most of the shops and lotteries listed on Hatsukore ship within Japan only. This page
        explains the routes overseas collectors commonly use, what they cost, and how to read the
        listings on this site. Hatsukore is an information site, not a seller — always confirm
        price, stock and conditions on each linked page.
      </p>

      <H2 id="tldr">The short version</H2>
      <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-neutral-700 dark:text-neutral-300">
        <li>
          <strong>Online pre-orders and store pages</strong> (items tagged{" "}
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
            🛒 Online (JP)
          </span>
          ) can usually be ordered through a <strong>proxy shopping service</strong> that buys and
          forwards for you.
        </li>
        <li>
          <strong>Online lotteries</strong> often require a Japanese address, phone number or store
          app, so entering from overseas is frequently not possible — check each entry page.
        </li>
        <li>
          <strong>In-store items</strong> (Ichiban Kuji at convenience stores, in-store raffles,
          event venues) cannot be bought directly from overseas.
        </li>
      </ul>

      <H2 id="proxy">How a proxy shopping service works</H2>
      <p className="mb-3 text-sm text-neutral-700 dark:text-neutral-300">
        A proxy (also called a forwarding or buying service) orders from Japanese shops on your
        behalf, receives the parcel at its warehouse in Japan, then ships it to you
        internationally. The usual flow:
      </p>
      <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-neutral-700 dark:text-neutral-300">
        <li>Create an account with a proxy service.</li>
        <li>
          Paste the Japanese product page URL into the service (or search inside the service’s own
          marketplace view), and pay the item price plus the service fee.
        </li>
        <li>The service buys the item and receives it at its Japan warehouse.</li>
        <li>You choose an international shipping method and pay the shipping cost.</li>
        <li>The parcel is forwarded to your address.</li>
      </ol>
      <p className="mt-3 text-sm text-neutral-700 dark:text-neutral-300">
        {/* Buyee を先頭に置く（本命・Indoleads承認後に計測リンクへ差し替え予定）。
            差し替え時はこの段落の直下にリンク近傍のアフィリ開示を追加すること。 */}
        Widely used services include{" "}
        <a href="https://buyee.jp/?lang=en" target="_blank" rel="nofollow noopener noreferrer" className="text-rose-600 hover:underline dark:text-rose-400">
          Buyee
        </a>
        ,{" "}
        <a href="https://zenmarket.jp/en/" target="_blank" rel="nofollow noopener noreferrer" className="text-rose-600 hover:underline dark:text-rose-400">
          ZenMarket
        </a>
        ,{" "}
        <a href="https://www.fromjapan.co.jp/en/" target="_blank" rel="nofollow noopener noreferrer" className="text-rose-600 hover:underline dark:text-rose-400">
          FROM JAPAN
        </a>{" "}
        and{" "}
        <a href="https://neokyo.com/" target="_blank" rel="nofollow noopener noreferrer" className="text-rose-600 hover:underline dark:text-rose-400">
          Neokyo
        </a>
        . Each has its own fees, supported shops and rules — compare before you order.
      </p>

      <H2 id="cost">What it really costs</H2>
      <p className="mb-3 text-sm text-neutral-700 dark:text-neutral-300">
        The sticker price on a Japanese shop page is <strong>not</strong> what you will pay in
        total. A proxy order usually adds up like this:
      </p>
      <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-neutral-700 dark:text-neutral-300">
        <li>Item price (JPY, as listed)</li>
        <li>Domestic shipping inside Japan (shop → proxy warehouse)</li>
        <li>The proxy service’s fee (per item or per order — see each service’s fee page)</li>
        <li>International shipping (by weight/size — often the largest extra cost)</li>
        <li>Import duties or taxes charged by your country, depending on the value</li>
      </ul>
      <p className="mt-3 text-sm text-neutral-700 dark:text-neutral-300">
        Expect the total to be noticeably higher than the listed price. Also note that some product
        types — aerosols, some batteries, liquids — can be restricted for international shipping;
        the proxy service will tell you at checkout.
      </p>

      <H2 id="what-you-can-get">What you can and can’t get from overseas</H2>
      <div className="flex flex-col gap-3 text-sm text-neutral-700 dark:text-neutral-300">
        <p>
          <strong className="text-neutral-900 dark:text-neutral-100">
            ✅ Online store pre-orders and purchases.
          </strong>{" "}
          Items marked{" "}
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
            🛒 Online (JP)
          </span>{" "}
          are ordered on an official Japanese online store or draw platform we have verified. Most
          ship within Japan only, which is exactly what a proxy solves. Whether a specific shop
          accepts proxy orders is decided by the shop and the service — the proxy will tell you if
          it cannot buy an item.
        </p>
        <p>
          <strong className="text-neutral-900 dark:text-neutral-100">
            ⚠️ Online lotteries and raffles.
          </strong>{" "}
          Many Japanese retail lotteries require a domestic address, a Japanese phone number for
          SMS, membership in the store’s app, or even purchase history at that store. Some proxy
          services offer lottery entry for certain platforms, but this varies — read the entry
          conditions on the linked page before counting on it.
        </p>
        <p>
          <strong className="text-neutral-900 dark:text-neutral-100">
            ❌ In-store only items.
          </strong>{" "}
          Ichiban Kuji and similar kuji are mostly drawn physically at convenience stores and hobby
          shops. In-store raffles and event-venue goods (pop-up shops, collab cafes) also require
          being there. Listings without the Online (JP) tag are unverified — many of them are
          in-store only.
        </p>
      </div>

      <H2 id="reading">Reading Hatsukore</H2>
      <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-neutral-700 dark:text-neutral-300">
        <li>
          <strong>All dates and times are JST</strong> (Japan Standard Time). A deadline like “Aug
          25, 23:59 JST” is earlier in your local time — in most of the US and Europe it falls
          during the daytime of Aug 25 or earlier.
        </li>
        <li>
          Months are always spelled out (“Sep 5”) to avoid the 9/5 vs 5/9 ambiguity. A label like
          “Sep 2026” means the source only announced the month, not an exact day.
        </li>
        <li>
          <strong>Date TBD</strong> means the source has not announced a date. Japanese text on a
          card is quoted from the source as-is — we do not translate product names, because English
          fan communities search by the official Japanese or romanized names.
        </li>
        <li>
          For lotteries, the date shown is usually the <strong>entry deadline</strong> when the
          source states one — the item page’s date heading says which it is.
        </li>
        <li>
          Prices are shown in JPY as listed (e.g. 850円 = ¥850). “1回850円” on a kuji means ¥850
          per draw, not the price of a prize.
        </li>
      </ul>

      <H2 id="glossary">Glossary</H2>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[9rem_1fr]">
        <dt className="font-semibold text-neutral-900 dark:text-neutral-100">Ichiban Kuji</dt>
        <dd className="text-neutral-700 dark:text-neutral-300">
          A ticket-style prize lottery sold at convenience stores and hobby shops. You pay per
          draw and always win one of the prize tiers (A-Prize, B-Prize, …). The Last One Prize
          goes to whoever draws the final ticket.
        </dd>
        <dt className="font-semibold text-neutral-900 dark:text-neutral-100">Kuji / online kuji</dt>
        <dd className="text-neutral-700 dark:text-neutral-300">
          “Kuji” is simply “lottery” in Japanese. Online kuji platforms let you draw on the web and
          ship the prizes — usually within Japan, so a forwarding address or proxy is needed.
        </dd>
        <dt className="font-semibold text-neutral-900 dark:text-neutral-100">Lottery (抽選)</dt>
        <dd className="text-neutral-700 dark:text-neutral-300">
          For high-demand items, Japanese retailers often sell the <em>right to buy</em> by
          lottery: you enter within a window, winners are drawn, and only winners can purchase.
        </dd>
        <dt className="font-semibold text-neutral-900 dark:text-neutral-100">Pre-order (予約)</dt>
        <dd className="text-neutral-700 dark:text-neutral-300">
          Ordering before release, first-come-first-served. Popular items can close early.
        </dd>
        <dt className="font-semibold text-neutral-900 dark:text-neutral-100">Restock (再販)</dt>
        <dd className="text-neutral-700 dark:text-neutral-300">
          A re-run of a previously sold item, often announced with its own pre-order window.
        </dd>
      </dl>

      <p className="mt-10 border-t border-neutral-200 pt-4 text-xs text-neutral-600 dark:text-neutral-400">
        Hatsukore lists publicly announced release, pre-order and lottery information. We are not
        affiliated with the shops running each sale, and conditions can change after we list an
        item — the linked official page is always the source of truth.{" "}
        <Link href="/en" className="text-rose-600 hover:underline dark:text-rose-400">
          ← Back to the schedule
        </Link>
      </p>
    </main>
  );
}
