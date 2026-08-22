-- 掲載スコープ列（Phase 3a・2026-08-22）。null＝日英両方／'en'＝EN専用カタログ行。
-- 適用は `npm run db:alter -- prisma/alter_scope.sql`（冪等・本番Tursoとローカルdev.dbの両方に流す）。
ALTER TABLE "Item" ADD COLUMN "scope" TEXT;
