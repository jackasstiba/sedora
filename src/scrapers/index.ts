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
];

export async function runAllScrapers(ctx: ScrapeContext): Promise<ScraperResult[]> {
  const results: ScraperResult[] = [];
  for (const { source, run } of SCRAPERS) {
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
