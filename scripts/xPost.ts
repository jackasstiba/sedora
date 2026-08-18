import fs from "node:fs";
import { loadCreds, postTweet, weightedLength, MAX_WEIGHTED } from "../src/lib/xApi";

// X への投稿CLI。**既定はドライラン**で、--confirm を付けたときだけ実際に投稿する。
// 投稿は取り消しの効かない公開行為なので、この二段構えは外さないこと。
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
