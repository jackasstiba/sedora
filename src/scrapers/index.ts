import { ScrapeContext, ScrapedItem } from "./types";
import { scrapeFigisland } from "./figisland";
import { scrapeFigislandPb } from "./figislandPb";
import { scrapeKoretore } from "./koretore";
import { scrapeTorecamap } from "./torecamap";
import { scrapeRarecheck } from "./rarecheck";
import { scrapeChanneltono } from "./channeltono";
import { scrapeSnkrdunk } from "./snkrdunk";
import { scrapeCollaboCafe } from "./collaboCafe";
import { scrapeIchibanKuji } from "./ichibanKuji";
import { scrapePokemonGoods } from "./pokemonGoods";
import { scrapePokemonCard } from "./pokemonCard";
import { scrapeNikeSnkrs } from "./nikeSnkrs";
import { scrapeTorecasoku } from "./torecasoku";
import { scrapeNyukaNow } from "./nyukaNow";
import { scrapeTenbaiQuest } from "./tenbaiquest";
import { scrapeRaffleKuji } from "./raffleKuji";
import { scrapeKujimap } from "./kujimap";
import { scrapeOnePieceCard } from "./onepieceCard";
import { scrapeCardChusen } from "./cardChusen";
import { scrapeGunplaResale } from "./gunplaResale";
import { scrapeSofvi } from "./sofvi";
import { scrapeMitaDraw } from "./mitaDraw";
import { scrapeChiikawaMarket } from "./chiikawaMarket";
import { scrapeTakaraTomyMall } from "./takaratomyMall";
import { scrapeBillys } from "./billys";
import { scrapeMedicomToy } from "./medicomToy";
import { scrapeGashapon } from "./gashapon";

export type ScraperResult = {
  source: string;
  items: ScrapedItem[];
  error: string | null;
};

type Scraper = (ctx: ScrapeContext) => Promise<ScrapedItem[]>;

const SCRAPERS: { source: string; run: Scraper }[] = [
  { source: "figisland", run: scrapeFigisland },
  { source: "figisland_pb", run: scrapeFigislandPb },
  { source: "koretore", run: scrapeKoretore },
  { source: "torecamap", run: scrapeTorecamap },
  { source: "rarecheck", run: scrapeRarecheck },
  { source: "channeltono", run: scrapeChanneltono },
  { source: "snkrdunk", run: scrapeSnkrdunk },
  { source: "collabo_cafe", run: scrapeCollaboCafe },
  { source: "ichiban_kuji", run: scrapeIchibanKuji },
  { source: "pokemon_goods", run: scrapePokemonGoods },
  { source: "pokemoncard", run: scrapePokemonCard },
  { source: "nike_snkrs", run: scrapeNikeSnkrs },
  { source: "torecasoku", run: scrapeTorecasoku },
  { source: "nyuka_now", run: scrapeNyukaNow },
  { source: "tenbaiquest", run: scrapeTenbaiQuest },
  { source: "raffle_kuji", run: scrapeRaffleKuji },
  { source: "kujimap", run: scrapeKujimap },
  { source: "onepiece_card", run: scrapeOnePieceCard },
  { source: "card_chusen", run: scrapeCardChusen },
  { source: "gunpla_resale", run: scrapeGunplaResale },
  { source: "sofvi", run: scrapeSofvi },
  // 2026-08-18 追加: 本番データを数えて「0件だったカテゴリ」を一次情報で埋める5本。
  // どれもアグリゲーターではなく公式ストア/公式抽選ページなので、収集元非公開の原則
  // （[[収集元の扱い方]]）の対象外＝item.url を公式として直リンクする。
  { source: "mita_draw", run: scrapeMitaDraw },
  { source: "chiikawa_market", run: scrapeChiikawaMarket },
  { source: "takaratomy_mall", run: scrapeTakaraTomyMall },
  { source: "billys", run: scrapeBillys },
  { source: "medicom_toy", run: scrapeMedicomToy },
  { source: "gashapon", run: scrapeGashapon },
];

/** 登録されている収集元の名前（`--only=` の検証に使う）。 */
export const SCRAPER_SOURCES = SCRAPERS.map((s) => s.source);

/**
 * 全ソースを巡回する。`only` を渡すとその収集元だけを回す。
 *
 * only を足した理由（2026-08-18）: 1ソースのスクレイパーを直しても、確かめるには
 * **21ソース・1時間の巡回を丸ごと回すしかなかった**。動かすのに1時間かかる仕組みは、
 * 直した日には一度も実行されない＝「仕組みで担保した」と書けてしまう
 * （[[System/rules]] 2026-08-17「単体で呼べる形にする」と同じ型）。
 */
export async function runAllScrapers(ctx: ScrapeContext, only?: string[]): Promise<ScraperResult[]> {
  const targets = only?.length ? SCRAPERS.filter((s) => only.includes(s.source)) : SCRAPERS;
  const results: ScraperResult[] = [];
  for (const { source, run } of targets) {
    try {
      const items = await run(ctx);
      results.push({ source, items, error: null });
    } catch (err) {
      results.push({
        source,
        items: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

export * from "./types";
