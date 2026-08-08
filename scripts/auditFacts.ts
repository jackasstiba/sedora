/**
 * 一次情報との突合（`npm run audit:facts`）。
 *
 * ここまでの監査は「自分の中で辻褄が合っているか」しか見ていない。データが最初から
 * 間違っていれば、どれだけ不変条件を足しても素通りする。そこで **リンク先の本文** を取り、
 * 手元の値と突き合わせる。
 *
 * ただし突合は誤報しやすい（SPA・画像内テキスト・表記ゆれ）。実測した信号の強さは:
 *   ・識別語がリンク先に出るか … 強い（商品の同一性。0/2以上で外れは実際に陳腐化・誤リンク）
 *   ・価格が本文にあるか       … 中（数字は載っていることが多いが、税抜/税込で揺れる）
 *   ・日付が本文にあるか       … 弱い（書式が多様・画像化されている）→ **判定しない。参考値だけ出す**
 * よって指摘するのは「識別語が1つも出ない」「価格が本文に無い」の2つに絞り、
 * どちらも WARN（要確認）に留める。誤報する検査は本物を埋もれさせるため。
 *
 * 使い方: npm run audit:facts [-- --per-source 3] [-- --source figisland]
 */
import * as cheerio from "cheerio";
import { prisma } from "../src/lib/prisma";
import { loadDisplayedItems } from "../src/lib/pages";
import { cleanListTitle } from "../src/lib/title";
import { normalizeForSearch } from "../src/lib/itemFilter";
import { franchiseAliases } from "../src/lib/franchise";
import { parseYen } from "../src/lib/margin";

// 本文の代わりにログイン壁・同意画面を返すホスト。文字数は十分あるので「本文が取れた」と
// 誤認し、識別語が1つも出ない＝要確認、という**中身を見ていない誤報**になる（実測: x_watch の
// item.url は投稿ではなくアカウントページで、そもそも画面にも出していないリンクだった）。
// 判定材料にならないものは「判定不能」に数える。0件と誤報は違う。
const WALLED_HOSTS = /(^|\.)(x\.com|twitter\.com)$/i;

const args = process.argv.slice(2);
const perIdx = args.indexOf("--per-source");
const PER_SOURCE = perIdx >= 0 ? Number(args[perIdx + 1]) || 3 : 3;
const srcIdx = args.indexOf("--source");
const ONLY_SOURCE = srcIdx >= 0 ? args[srcIdx + 1] : null;

// 商品名に頻出する一般語。識別語から外さないと「フィギュア」だけで一致してしまう。
const GENERIC =
  /^(フィギュア|ぬいぐるみ|プラモデル|カードゲーム|ブースターパック|拡張パック|完成品|限定|特典|予約|発売|再販|セット|ver|box|新作|グッズ|コラボ|オンライン|一番くじ|抽選|販売|アクリルスタンド|キーホルダー|ポップアップストア)$/i;

function identityTokens(title: string): string[] {
  return title
    .split(/[\s　【】『』「」（）()[\]・/／\-–—~〜,、。!！?？:：＆&×✕]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !GENERIC.test(t))
    .map(normalizeForSearch)
    .filter((t, i, a) => a.indexOf(t) === i)
    .slice(0, 6);
}

async function pageText(url: string): Promise<string | null> {
  try {
    if (WALLED_HOSTS.test(new URL(url).hostname)) return null;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SedoriRadar-audit/1.0)" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const $ = cheerio.load(await res.text());
    $("script, style, noscript").remove();
    const t = $("body").text().replace(/\s+/g, " ");
    // 本文が極端に短いページ（SPAの殻など）は判定材料にならないので除外する。
    return t.length < 500 ? null : normalizeForSearch(t);
  } catch {
    return null;
  }
}

type Finding = { kind: string; detail: string };

async function main() {
  const rows = (await loadDisplayedItems()).filter((r) => !ONLY_SOURCE || r.source === ONLY_SOURCE);
  const bySource = new Map<string, typeof rows>();
  for (const r of rows) (bySource.get(r.source) ?? bySource.set(r.source, []).get(r.source)!).push(r);

  const findings: Finding[] = [];
  let checked = 0;
  let unusable = 0;
  let dateHit = 0;
  let dateTotal = 0;

  console.log(`== ハツコレ 一次情報の突合 == (ソースごと ${PER_SOURCE}件)`);

  for (const [source, arr] of bySource) {
    // 決定的に散らす（毎回同じ先頭だけを見ると、同じページしか検査しない）。
    const step = Math.max(1, Math.floor(arr.length / PER_SOURCE));
    const sample = arr.filter((_, i) => i % step === 0).slice(0, PER_SOURCE);
    for (const r of sample) {
      const text = await pageText(r.url);
      if (!text) {
        unusable++;
        continue;
      }
      checked++;
      const title = cleanListTitle(r.source, r.title);
      const toks = identityTokens(title);

      // (1) 同一性: 識別語が2つ以上あるのに1つも本文に出てこない＝別物か陳腐化。
      //     ただし作品名は日英・カナで表記が割れる（こちらが「ONE PIECE カードゲーム」、
      //     一次情報は「ワンピースカードゲーム」＝正しいリンクなのに要確認になっていた）。
      //     既にある作品エイリアス表を同一性の判定にも通す。
      const aliases = franchiseAliases(title).map(normalizeForSearch);
      const matched = toks.some((k) => text.includes(k)) || aliases.some((a) => text.includes(a));
      if (toks.length >= 2 && !matched) {
        findings.push({
          kind: "リンク先に商品が見当たらない",
          detail: `[${source} #${r.id}] 識別語 ${toks.join(" / ")} がどれも本文に無い → ${r.url}`,
        });
      }

      // (2) 価格: 手元の定価が本文のどこにも出てこない。
      const yen = r.price ? parseYen(r.price.split(" / ")[0]) : null;
      if (yen != null && yen > 0) {
        const forms = [String(yen), yen.toLocaleString("en-US")];
        if (!forms.some((f) => text.includes(normalizeForSearch(f)))) {
          findings.push({
            kind: "価格が一次情報に見当たらない",
            detail: `[${source} #${r.id}] 掲載価格 ${r.price} が本文に無い ${title.slice(0, 40)}`,
          });
        }
      }

      // (3) 日付は参考値のみ（書式が多様で判定に耐えない）。
      if (r.eventDate) {
        const d = new Date(r.eventDate);
        dateTotal++;
        if (
          text.includes(`${d.getUTCMonth() + 1}月${d.getUTCDate()}日`) ||
          text.includes(`${d.getUTCMonth() + 1}/${d.getUTCDate()}`)
        )
          dateHit++;
      }
      await new Promise((s) => setTimeout(s, 300));
    }
  }

  console.log(
    `突合できたページ ${checked}件 / 本文を取れず判定不能 ${unusable}件 / ` +
      `日付が本文に見つかった割合 ${dateTotal ? Math.round((dateHit / dateTotal) * 100) : 0}%（参考・判定には使わない）`
  );

  if (findings.length === 0) {
    console.log("\n==== 一次情報の突合: 要確認 0件 ====");
    await prisma.$disconnect();
    return;
  }
  const byKind = new Map<string, Finding[]>();
  for (const f of findings) (byKind.get(f.kind) ?? byKind.set(f.kind, []).get(f.kind)!).push(f);
  for (const [kind, arr] of byKind) {
    console.log(`\n【⚠️要確認】${kind}: ${arr.length}件`);
    for (const f of arr.slice(0, 10)) console.log(`   - ${f.detail}`);
    if (arr.length > 10) console.log(`   … 他 ${arr.length - 10}件`);
  }
  console.log(`\n==== 一次情報の突合: 要確認 ${findings.length}件（抜き取り ${checked}件中） ====`);
  await prisma.$disconnect();
}

main();
