import { createClient } from "@libsql/client";

// Item テーブルに prizes 列（一番くじ各等賞のJSON）を追加する増分マイグレーション。
// 追加のみ（nullable）＝既存 Item・稼働サイトに無影響。SQLite の ALTER TABLE ADD COLUMN は
// 列が既にあると失敗するので pragma table_info で存在チェックしてから実行する（冪等）。
// 実行: npm run migrate:prizes   （.env の TURSO_* を使用）
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
  if (cols.has("prizes")) {
    console.log("prizes 列は既に存在します（スキップ）。");
  } else {
    await client.execute(`ALTER TABLE "Item" ADD COLUMN "prizes" TEXT`);
    console.log("OK: ALTER TABLE Item ADD COLUMN prizes TEXT");
  }

  const res = await client.execute(
    `SELECT count(*) AS n FROM Item WHERE source='ichiban_kuji'`
  );
  console.log("一番くじの行数:", res.rows[0].n);
  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
