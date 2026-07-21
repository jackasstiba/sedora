import { readFileSync } from "node:fs";
import { createClient } from "@libsql/client";

// Turso にスキーマ（prisma/schema_turso.sql）を適用する。
// .env の TURSO_DATABASE_URL / TURSO_AUTH_TOKEN を使う。
async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !url.startsWith("libsql://")) {
    console.error("TURSO_DATABASE_URL が libsql://... で設定されていません。");
    process.exit(1);
  }
  if (!authToken) {
    console.error("TURSO_AUTH_TOKEN が未設定です。.env に認証トークンを貼り付けてください。");
    process.exit(1);
  }

  const client = createClient({ url, authToken });
  const raw = readFileSync("prisma/schema_turso.sql", "utf8");
  // コメント行(-- ...)を除去してから ; で分割する
  const sql = raw
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    await client.execute(stmt);
    console.log("OK:", stmt.split("\n")[0].slice(0, 60));
  }

  const res = await client.execute("SELECT count(*) AS n FROM Item");
  console.log("Item テーブル作成完了。現在の行数:", res.rows[0].n);
  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
