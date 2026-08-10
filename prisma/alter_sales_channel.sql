-- 取扱店（平文）フィールド追加（既存のTurso本番DB向けマイグレーション / 2026-08-10）
-- 適用: npm run db:alter （scripts/applyAlter.ts が本番Turso/ローカルdev.dbに冪等適用）
-- nullable の追加列なので既存データ・稼働中サイトに影響なし。
ALTER TABLE "Item" ADD COLUMN "salesChannel" TEXT;

-- prizes / stores も schema.prisma にはあるが alter ファイルが無く、本番へは手作業で
-- 入っていた（＝新しいDBを作ると欠ける）。冪等適用なので既にある環境では飛ばされる。
ALTER TABLE "Item" ADD COLUMN "prizes" TEXT;
ALTER TABLE "Item" ADD COLUMN "stores" TEXT;
