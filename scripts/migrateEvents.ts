import { createClient } from "@libsql/client";

// Event テーブル（自前アクセス解析）を Turso 本番に追加する増分マイグレーション。
// 追加のみ（CREATE TABLE IF NOT EXISTS）＝既存 Item・稼働サイトに無影響。
// 実行: npm run migrate:events   （.env の TURSO_* を使用）
const DDL = [
  `CREATE TABLE IF NOT EXISTS "Event" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "value" TEXT,
    "data" TEXT,
    "path" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS "Event_name_createdAt_idx" ON "Event"("name", "createdAt")`,
];

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !url.startsWith("libsql://")) {
    console.error("TURSO_DATABASE_URL が libsql://... で設定されていません。");
    process.exit(1);
  }
  const client = createClient({ url, authToken });
  for (const stmt of DDL) {
    await client.execute(stmt);
    console.log("OK:", stmt.split("\n")[0].slice(0, 60));
  }
  const res = await client.execute("SELECT count(*) AS n FROM Event");
  console.log("Event テーブル準備完了。現在の行数:", res.rows[0].n);
  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
