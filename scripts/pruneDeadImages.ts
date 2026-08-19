import { pathToFileURL } from "node:url";
import { prisma } from "../src/lib/prisma";
import { loadDisplayedItems } from "../src/lib/pages";
import { imageVerdict, type ImageVerdict } from "../src/lib/deadImage";
import { parsePrizesJson } from "../src/lib/prizes";

/**
 * **もう画像を返さないURLを、保存側から落とす**（`npm run images:prune`）。
 *
 * 由来（2026-08-19 実測）: 画像を自ドメイン経由にしてから、取れなかった画像は
 * 透明1×1として 200 で配られる。ブラウザから見れば「正常な画像」なので、
 * **カードにはただの空白**が出る（商品名を大きく出す NoImage タイルにもならない）。
 * 表示中2,029枚を1枚ずつ取りに行って測ったら3枚が 404 だった＝目視でもHTMLでも
 * データ監査でも気付けない。**実際に取りに行く工程を更新の中に置く**しかない。
 *
 * 消す条件は src/lib/deadImage.ts の `imageVerdict` ただ1つで、画像プロキシも同じ関数を見る。
 * 一時障害（接続失敗・5xx）では**消さない**。消したら二度と戻らないため。
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const TIMEOUT_MS = 12_000;
const CONCURRENCY = 16;
const DRY = process.argv.includes("--dry");

async function probe(url: string): Promise<ImageVerdict> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "image/*,*/*;q=0.8" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow",
    });
    // 本文の長さまで見ないと「200なのに0バイト」を落とせない。
    const bytes = res.ok ? (await res.arrayBuffer()).byteLength : null;
    return imageVerdict({ status: res.status, contentType: res.headers.get("content-type"), bytes });
  } catch {
    return imageVerdict({ status: null, contentType: null, bytes: null });
  }
}

/** URLごとの判定を1回だけ行う（同じ画像を共有している行があるため）。 */
async function judgeAll(urls: string[]): Promise<Map<string, ImageVerdict>> {
  const uniq = [...new Set(urls)];
  const out = new Map<string, ImageVerdict>();
  const queue = uniq.slice();
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        const u = queue.shift();
        if (!u) return;
        out.set(u, await probe(u));
      }
    })
  );
  return out;
}

export async function runDeadImagePrune(): Promise<void> {
  const shown = await loadDisplayedItems();

  const itemUrls = shown.map((r) => r.imageUrl).filter((u): u is string => !!u);
  const prizeRows = shown
    .map((r) => ({ id: r.id, prizes: parsePrizesJson(r.prizes) }))
    .filter((r) => r.prizes?.length);
  const prizeUrls = prizeRows.flatMap((r) =>
    (r.prizes ?? []).map((p) => p.image).filter((u): u is string => !!u)
  );

  console.log(
    `対象: 表示中 ${shown.length}件のうち 商品画像 ${itemUrls.length}枚 / 各賞画像 ${prizeUrls.length}枚（${prizeRows.length}商品）を実際に取りに行く`
  );
  const verdicts = await judgeAll([...itemUrls, ...prizeUrls]);

  const dead = [...verdicts.values()].filter((v) => v === "dead").length;
  const unknown = [...verdicts.values()].filter((v) => v === "unknown").length;
  console.log(
    `判定: 生きている ${verdicts.size - dead - unknown} / 死んでいる ${dead} / 一時失敗（消さない） ${unknown}（URLの異なり ${verdicts.size}）`
  );

  let clearedItems = 0;
  for (const r of shown) {
    if (!r.imageUrl || verdicts.get(r.imageUrl) !== "dead") continue;
    console.log(`  商品画像を外す #${r.id} ${r.title.slice(0, 34)} → ${r.imageUrl.slice(0, 70)}`);
    if (!DRY) await prisma.item.update({ where: { id: r.id }, data: { imageUrl: null } });
    clearedItems++;
  }

  let clearedPrizes = 0;
  for (const row of prizeRows) {
    const prizes = row.prizes ?? [];
    let touched = false;
    const next = prizes.map((p) => {
      if (p.image && verdicts.get(p.image) === "dead") {
        touched = true;
        clearedPrizes++;
        return { ...p, image: null };
      }
      return p;
    });
    if (!touched) continue;
    console.log(`  各賞画像を外す #${row.id}（${next.filter((p) => !p.image).length}枠）`);
    if (!DRY) await prisma.item.update({ where: { id: row.id }, data: { prizes: JSON.stringify(next) } });
  }

  console.log(
    `${DRY ? "外す予定" : "外した"}: 商品画像 ${clearedItems}件 / 各賞画像 ${clearedPrizes}枠` +
      (clearedItems || clearedPrizes ? "（NoImageタイルに落ちる＝空白が出なくなる）" : "")
  );
}

async function main() {
  console.log("== 死んだ画像の掃除 ==");
  await runDeadImagePrune();
}

// 単体実行（`npm run images:prune`）のときだけ回して切断する。
// scrape.ts から import されたときに走り出さないよう入口を分ける
// （import しただけで動くと、scrape の途中で prisma を切断してしまう）。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    () => prisma.$disconnect(),
    async (e) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(1);
    }
  );
}
