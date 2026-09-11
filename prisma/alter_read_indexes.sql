-- 2026-09-11 読み取り量削減。Turso 本番へは libsql クライアントで流す（何度流しても安全）。
CREATE INDEX IF NOT EXISTS "Item_scrapedAt_idx" ON "Item"("scrapedAt");
CREATE INDEX IF NOT EXISTS "Item_source_eventDate_idx" ON "Item"("source", "eventDate");
