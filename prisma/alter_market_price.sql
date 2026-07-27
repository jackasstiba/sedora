-- 相場フィールド追加（既存のTurso本番DB向けマイグレーション / 2026-07-27）
-- 適用: turso db shell <DB名> < prisma/alter_market_price.sql
-- すべて nullable の追加列なので既存データ・稼働中サイトに影響なし（冪等ではないので一度だけ実行）。
ALTER TABLE "Item" ADD COLUMN "marketPrice" INTEGER;
ALTER TABLE "Item" ADD COLUMN "marketPriceText" TEXT;
ALTER TABLE "Item" ADD COLUMN "marketUrl" TEXT;
ALTER TABLE "Item" ADD COLUMN "marketSource" TEXT;
ALTER TABLE "Item" ADD COLUMN "marketCheckedAt" DATETIME;
