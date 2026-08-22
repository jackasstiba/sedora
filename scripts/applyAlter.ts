import { readFileSync } from "node:fs";
import { createClient } from "@libsql/client";

// prisma/alter_*.sql の ALTER TABLE を、いま繋がっているDB（本番Turso or ローカルdev.db）に
// **冪等に**適用する。
//
// これまで列追加は `turso db shell < prisma/alter_*.sql` の手作業だった（alter_market_price.sql の
// コメント参照）。手順が人間の記憶に依存し、しかも二度流すと "duplicate column" で落ちるので
// 誰も再実行できない＝ローカルと本番でスキーマがずれても気づけない。
// PRAGMA table_info で既に在る列は飛ばし、何度でも安全に流せるようにする。
//
// 使い方: npm run db:alter [-- prisma/alter_sales_channel.sql ...]
//   引数なしなら既知の alter ファイルを全部流す。

const DEFAULT_FILES = [
  "prisma/alter_market_price.sql",
  "prisma/alter_sales_channel.sql",
  "prisma/alter_scope.sql",
];

type Alter = { table: string; column: string; stmt: string };

/** ALTER TABLE "X" ADD COLUMN "y" TYPE; の行だけを拾う（他のDDLは扱わない＝想定外を黙って流さない）。 */
function parseAlters(sql: string): Alter[] {
  const out: Alter[] = [];
  for (const line of sql.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("--")) continue;
    const m = t.match(/^ALTER\s+TABLE\s+"?(\w+)"?\s+ADD\s+COLUMN\s+"?(\w+)"?/i);
    if (!m) {
      console.warn(`  skip (ADD COLUMN 以外): ${t.slice(0, 60)}`);
      continue;
    }
    out.push({ table: m[1], column: m[2], stmt: t.replace(/;+$/, "") });
  }
  return out;
}

async function main() {
  const files = process.argv.slice(2).filter((a) => a.endsWith(".sql"));
  const targets = files.length ? files : DEFAULT_FILES;

  const url = process.env.TURSO_DATABASE_URL || "file:./dev.db";
  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || undefined });
  console.log(`[alter] target db: ${url.startsWith("libsql") ? url : "local dev.db"}`);

  let applied = 0;
  let skipped = 0;
  for (const file of targets) {
    console.log(`[alter] ${file}`);
    for (const a of parseAlters(readFileSync(file, "utf8"))) {
      const info = await client.execute(`PRAGMA table_info("${a.table}")`);
      const exists = info.rows.some((r) => String(r.name) === a.column);
      if (exists) {
        skipped++;
        console.log(`  = ${a.table}.${a.column} は既に存在（スキップ）`);
        continue;
      }
      await client.execute(a.stmt);
      applied++;
      console.log(`  + ${a.table}.${a.column} を追加`);
    }
  }
  console.log(`[alter] done. applied=${applied} skipped=${skipped}`);
  client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
