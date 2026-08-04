import { createClient } from "@libsql/client";

// Item テーブルに stores 列（家電・ゲーム機などの「受付中の公式ストア一覧」JSON）を追加する
// 増分マイグレーション。追加のみ（nullable）＝既存 Item・稼働サイトに無影響。
// SQLite の ALTER TABLE ADD COLUMN は列が既にあると失敗するので pragma で存在チェックする（冪等）。
// 実行: npm run migrate:stores   （.env の TURSO_* を使用）
async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !url.startsWith("libsql://")) {
    console.error("TURSO_DATABASE_URL が libsql://... で設定されていません。");
    process.exit(1);
  }
  const client = createClient({ url, authToken });

  const info = await client.execute(`PRAGMA table_info("Item")`);
  const cols = new Set(info.rows.map((r) => String(r.name)));
  if (cols.has("stores")) {
    console.log("stores 列は既に存在します（スキップ）。");
  } else {
    await client.execute(`ALTER TABLE "Item" ADD COLUMN "stores" TEXT`);
    console.log("OK: ALTER TABLE Item ADD COLUMN stores TEXT");
  }
  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
