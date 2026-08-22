/**
 * collabo_cafe の highlights / hasLottery を、現在の analyzeCollab ロジックで作り直す。
 *
 * 背景: 通常の `npm run scrape` は「今カテゴリ一覧に載っている記事」だけを upsert するため、
 * 一覧から落ちた（が発売日が未来で表示スコープに残る）古い記事は旧ラベルのまま固着する。
 * enrich ロジック（抽選判定・登場グッズ・関連記事の切り落とし）を変えたら、このスクリプトで
 * 表示スコープの collabo 全件を再取得して作り直す。冪等・非破壊（highlights/hasLottery のみ更新）。
 */
import { prisma } from "../src/lib/prisma";
import { loadDisplayedItems } from "../src/lib/pages";
import { fetchHtml, sleep } from "../src/scrapers/util";
import {
  analyzeCollab,
  extractArticleBody,
  extractOfficialItems,
  extractOfficialSale,
  extractOfficialUrl,
  extractMapUrl,
  extractVenues,
  formatVenueStores,
  formatOfficialItems,
  formatSale,
  parseShopifyOfficialItems,
  pickVerifiedEventDate,
  shopifyJsonUrl,
} from "../src/scrapers/collaboEnrich";

async function fetchOfficial(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SedoriRadar/1.0)" },
      signal: AbortSignal.timeout(12000),
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/** 公式URLが Shopify の形なら公開JSONから商品名＋価格を取る（collaboCafe と同じ判断）。 */
async function fetchShopifyItems(url: string): Promise<{ name: string; price: number }[] | null> {
  const jsonUrl = shopifyJsonUrl(url);
  if (!jsonUrl) return null;
  const body = await fetchOfficial(jsonUrl);
  return body ? parseShopifyOfficialItems(body) : null;
}

async function main() {
  // 対象は「サイトが実際に表示しているアイテム」（src/lib/pages.ts）から取る。
  // 自前の where で「表示スコープ」を書き直すと必ずズレる: 以前は「今後＋日付未定＋相場つき」
  // で絞っていたため、月ページが見せる**当月の過ぎた日**の記事がエンリッチの外に落ち、
  // 廃止したはずの未確認ラベル「抽選賞品：X」が10件、本番に固着していた（実測）。
  const displayed = await loadDisplayedItems();
  const items = displayed.filter((r) => r.source === "collabo_cafe");
  console.log(`表示中の collabo_cafe ${items.length}件を再エンリッチ`);

  let changed = 0;
  let dateFixed = 0;
  for (const it of items) {
    try {
      const html = await fetchHtml(it.url);
      const body = extractArticleBody(html);
      const enr = analyzeCollab(body, it.subGenre);

      // 開催日の裏取り: 一覧の「期間 :」は収集元側で誤っていることがあるため、記事本文の
      // 「開催期間」とタイトルの日付が一致した場合だけ日付を正す（推測では動かさない）。
      const verified = pickVerifiedEventDate(body, it.title, it.eventDate);
      if (verified && verified.date.getTime() !== (it.eventDate?.getTime() ?? -1)) {
        await prisma.item.update({
          where: { id: it.id },
          data: { eventDate: verified.date, eventDateText: verified.text },
        });
        dateFixed++;
        console.log(
          `  #${it.id}: 開催日 ${it.eventDate?.toISOString().slice(0, 10) ?? "未定"}→` +
            `${verified.date.toISOString().slice(0, 10)} «${verified.text}» ${it.title}`
        );
      }

      const official = extractOfficialUrl(html, { allowSingleProduct: it.eventType !== "開催" });
      let saleText: string | null = null;
      if (official) {
        // ① Shopify の公開JSON（最も正確） ② サイト別パーサ ③ 価格帯のみ、の順に落とす。
        const shopItems = await fetchShopifyItems(official);
        if (shopItems) saleText = formatOfficialItems(shopItems);
        if (!saleText) {
          const oh = await fetchOfficial(official);
          if (oh) {
            const oi = extractOfficialItems(official, oh);
            saleText = oi ? formatOfficialItems(oi) : null;
            if (!saleText) {
              const s = extractOfficialSale(oh);
              if (s) saleText = formatSale(s);
            }
          }
        }
        await sleep(250);
      }
      const highlights = [enr.highlights, saleText].filter(Boolean).join(" ｜ ") || null;
      // 開催店舗＋地図。スクレイパー本体は収集元の一覧に今出ている記事しか回らないので、
      // 既に載っている（＝表示中の）過去記事は**ここでしか埋まらない**。
      const stores = formatVenueStores(extractVenues(html), extractMapUrl(html));

      // officialUrl もここで作り直す。以前は highlights/hasLottery/stores だけを更新していたため、
      // 「リンクの選び方を直しても、既に載っている記事のリンクは古い誤ったまま」だった
      // （通常の scrape は収集元の一覧に今出ている記事しか回らない＝直らない経路が残る）。
      // 記事HTMLの取得に成功した回だけ書くので、取得失敗で既存値を潰すことはない。
      if (
        highlights !== it.highlights ||
        enr.hasLottery !== it.hasLottery ||
        stores !== it.stores ||
        official !== it.officialUrl
      ) {
        await prisma.item.update({
          where: { id: it.id },
          data: { highlights, hasLottery: enr.hasLottery, stores, officialUrl: official },
        });
        changed++;
        const link = official !== it.officialUrl ? ` | 公式 ${it.officialUrl ?? "(なし)"} → ${official ?? "(なし)"}` : "";
        console.log(`  #${it.id}: hasLottery ${it.hasLottery}→${enr.hasLottery} | ${highlights ?? "(null)"}${link}`);
      }
    } catch (e) {
      console.log(`  #${it.id}: 取得失敗 ${(e as Error).message}`);
    }
    await sleep(350);
  }
  console.log(`\n更新 ${changed}件（うち開催日の訂正 ${dateFixed}件）`);
  await prisma.$disconnect();
}

main();
