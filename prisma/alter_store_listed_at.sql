-- 収集元の店に並んだ日（Phase 3b・2026-08-22）。EN専用カタログの並び順に使う。
-- イベント日ではないので eventDate とは別列。適用は `npm run db:alter`（冪等）。
ALTER TABLE "Item" ADD COLUMN "storeListedAt" DATETIME;
