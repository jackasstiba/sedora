import { prisma } from "../src/lib/prisma";
import { fetchSurugayaPrice, norm } from "../src/scrapers/surugayaPrice";
import { parsePrizesJson, isHotPrize, type PrizeFull } from "../src/lib/prizes";
import { stripSourceLabel } from "../src/lib/title";

// 一番くじの各等賞に「二次相場（駿河屋バラ売り＝実中古相場）」を後付けする増分スクリプト。
// メルカリは署名APIのみで自動取得不可のため（半自動X巡回の担当）、自動化できる駿河屋を使う。
// 駿河屋の中古は発売済み品にしか付かない＝未発売くじは付かない（正常。発売後に埋まる成長型）。
//
// 相場が取れるのは「相場の核」＝A賞・ラストワン賞等に絞る（全10賞を毎回引くのは負荷過大かつ、
// 相場が付くのは主に人気の高額賞）。既に相場付きの賞はスキップ（差分）。
// 実行: npm run scrape:kuji:prices -- [--limit N] [--all]
const args = process.argv.slice(2);
const limit = Number(args[find("--limit")] ?? 0) || Infinity;
const all = args.includes("--all"); // 注目賞に限らず全賞を引く

function find(flag: string): number {
  const i = args.indexOf(flag);
  return i >= 0 ? i + 1 : -1;
}

function targetPrize(p: PrizeFull): boolean {
  if (p.resalePrice != null) return false; // 既に相場あり＝スキップ（差分）
  return all || isHotPrize(p.label) || p.label === "B賞" || p.label === "C賞";
}

// 賞品名の“核トークン”（先頭のキャラ名/品名。フィギュア・MASTERLISE 等の一般語は落とす）。
// これが駿河屋のヒット商品名に含まれていなければ誤マッチとみなす（同シリーズの安い別商品対策）。
const GENERIC_TOKEN =
  /^(フィギュア|ぬいぐるみ|マスコット|アクリルスタンド|アクスタ|タオル|クッション|ラバー|ステッカー|カード|グラス|皿|セット|masterlise|expiece|plus|displayful|ver|【.*】)$/i;
function coreToken(name: string): string {
  for (const tok of name.split(/[\s　]+/)) {
    const t = tok.trim();
    if (t.length >= 2 && !GENERIC_TOKEN.test(t)) return t;
  }
  return name.trim();
}
/** ヒット商品名が賞品の核トークンを実際に含むか（＝本当にその賞か）を検証。 */
function nameConfirms(prizeName: string, matchedName: string | undefined): boolean {
  if (!matchedName) return false;
  const core = coreToken(prizeName);
  if (core.length < 2) return false;
  return norm(matchedName).includes(norm(core));
}

async function main() {
  const items = await prisma.item.findMany({
    where: { source: "ichiban_kuji", prizes: { not: null } },
    select: { id: true, title: true, prizes: true },
    orderBy: { id: "desc" },
  });

  let processedItems = 0;
  let filled = 0;

  for (const it of items) {
    if (processedItems >= limit) break;
    const prizes = parsePrizesJson(it.prizes);
    if (!prizes) continue;
    const targets = prizes.filter(targetPrize);
    if (targets.length === 0) continue;

    processedItems++;
    const base = stripSourceLabel(it.title); // "一番くじ ◯◯ …"
    let changed = false;

    for (const p of targets) {
      // 検索語＝商品名＋賞品名（賞ラベルは駿河屋の商品名に無いことが多いので入れない）
      const q = `${base} ${p.name}`.replace(/\s+/g, " ").trim();
      const market = await fetchSurugayaPrice(q);
      await sleep(800); // レート制限
      if (market && nameConfirms(p.name, market.matchedName)) {
        p.resalePrice = market.price;
        p.resaleText = market.priceText;
        p.resaleUrl = market.url;
        p.resaleSource = market.source;
        filled++;
        changed = true;
        console.log(`  [${it.id}] ${p.label} ${p.name} → ${market.priceText}  (${market.matchedName})`);
      } else if (market) {
        console.log(`  [${it.id}] ${p.label} ${p.name} ✗誤マッチ除外 (${market.matchedName} / ${market.priceText})`);
      }
    }

    if (changed) {
      await prisma.item.update({
        where: { id: it.id },
        data: { prizes: JSON.stringify(prizes) },
      });
    }
  }

  console.log(`対象 ${processedItems} 商品を確認、賞相場を ${filled} 件付与しました`);
  await prisma.$disconnect();
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
