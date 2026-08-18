import { loadCreds, verifyCredentials } from "../src/lib/xApi";

// .env の X 資格情報が通るかだけを確かめる。投稿は一切しない。
// 使い方: npm run x:verify

async function main() {
  const creds = loadCreds();
  const me = await verifyCredentials(creds);
  console.log(`✅ 認証OK: @${me.username}（${me.name} / id=${me.id}）`);
  console.log("   ※これは読み取りの確認です。投稿権限は npm run x:post のドライラン→--confirm で確かめます。");
}

main().catch((e) => {
  console.error(`❌ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
