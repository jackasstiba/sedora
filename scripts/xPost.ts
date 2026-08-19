import fs from "node:fs";
import { loadCreds, postTweet, weightedLength, MAX_WEIGHTED } from "../src/lib/xApi";
import { findForbidden, findStaleNumbers } from "../src/lib/xDraftText";
import { loadPostFacts, toFactCounts } from "../src/lib/xFacts";

// X への投稿CLI。**既定はドライラン**で、--confirm を付けたときだけ実際に投稿する。
// 投稿は取り消しの効かない公開行為なので、この二段構えは外さないこと。
//
// 送る直前に**本文そのもの**を2つの物差しに通す（下書き側だけで見ても意味がない。
// 手で書いたファイルも古いファイルもここを通るため）:
//  ①立ち位置に反する語（相場・利益・転売…）
//  ②本文に書いた数が今のデータと合っているか
//    （2026-08-19 実測: 8/18に手で書いた告知が 2,139件 のまま、実データは 1,873件 だった）
// 逃げ道は用意しない。引っかかったら本文を直すか、npm run x:draft で作り直す。
//
// 使い方:
//   npm run x:post -- --file drafts/foo.txt              ← 下書きを確認（投稿しない）
//   npm run x:post -- --file drafts/foo.txt --confirm    ← 実際に投稿する
//   npm run x:post -- --text "短い本文"                   ← 1行ならこちらでも可
//
// 日本語の本文は --file を推奨。シェル越しに渡すと引用符やスペースで壊れやすい。

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const file = arg("file");
  const inline = arg("text");
  if (!file && !inline) {
    console.error("本文がありません。--file <path> か --text <string> を指定してください。");
    process.exit(1);
  }

  const text = (file ? fs.readFileSync(file, "utf8") : inline!).replace(/\s+$/, "");
  const len = weightedLength(text);
  const confirm = process.argv.includes("--confirm");

  console.log("─".repeat(60));
  console.log(text);
  console.log("─".repeat(60));
  console.log(`重み付き文字数: ${len} / ${MAX_WEIGHTED}（日本語1文字=2・URL一律23）`);

  if (len > MAX_WEIGHTED) {
    console.error(`❌ 上限超過。${len - MAX_WEIGHTED} 分を削ってください。`);
    process.exit(1);
  }

  const ng = findForbidden(text);
  if (ng.length) {
    console.error(`❌ 立ち位置に反する語が入っています: ${ng.join(" / ")}`);
    process.exit(1);
  }

  const stale = findStaleNumbers(text, toFactCounts(await loadPostFacts()));
  if (stale.length) {
    console.error("❌ 本文の数が今のデータと合いません（そのまま送ると嘘になります）:");
    for (const s of stale) console.error(`   ・${s}`);
    console.error("   → npm run x:draft -- --outdir=drafts で作り直してください。");
    process.exit(1);
  }
  console.log("✅ 語彙・数の照合OK（今のデータと一致）");

  if (!confirm) {
    console.log("\n🟡 ドライランです。まだ投稿していません。");
    console.log("   実際に投稿するには同じコマンドに --confirm を付けてください。");
    return;
  }

  const creds = loadCreds();
  const res = await postTweet(text, creds);
  console.log(`\n✅ 投稿しました: https://x.com/i/status/${res.id}`);
}

main().catch((e) => {
  console.error(`❌ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
