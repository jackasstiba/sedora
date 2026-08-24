import { createClient } from "@libsql/client";

// DailySnapshot テーブルを追加する増分マイグレーション（2026-08-22 新設）。
// 追加のみ（CREATE TABLE IF NOT EXISTS）＝既存 Item・稼働サイトに無影響。
// 実行: npm run migrate:snapshots  （.env があれば本番Turso、無ければローカル dev.db）
//
// migrateEvents.ts と同じ作りだが、**接続先はローカルにも向く**ようにしてある
// （applyAlter.ts と同じ選び方）。ローカル dev.db に表が無いと `npm run snapshot` を
// 手元で試せず、本番で初めて動かすことになるため。
const DDL = [
  `CREATE TABLE IF NOT EXISTS "DailySnapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "day" DATETIME NOT NULL,
    "dim" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "newCount" INTEGER,
    "lotteryCount" INTEGER NOT NULL,
    "datedCount" INTEGER NOT NULL,
    "maxItemId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  // 同じ日を2回巡回しても行が増えない（上書きされる）ための一意制約。
  `CREATE UNIQUE INDEX IF NOT EXISTS "DailySnapshot_day_dim_key_key" ON "DailySnapshot"("day", "dim", "key")`,
  `CREATE INDEX IF NOT EXISTS "DailySnapshot_dim_key_day_idx" ON "DailySnapshot"("dim", "key", "day")`,
];

async function main() {
  const url = process.env.TURSO_DATABASE_URL || "file:./dev.db";
  const authToken = process.env.TURSO_AUTH_TOKEN || undefined;
  console.log(`[migrate] target db: ${url.startsWith("libsql") ? url : "local dev.db"}`);

  const client = createClient({ url, authToken });
  for (const stmt of DDL) {
    await client.execute(stmt);
    console.log("OK:", stmt.split("\n")[0].slice(0, 70));
  }
  const res = await client.execute("SELECT count(*) AS n FROM DailySnapshot");
  console.log("DailySnapshot 準備完了。現在の行数:", res.rows[0].n);
  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
