-- CreateTable
CREATE TABLE "Item" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "genre" TEXT NOT NULL,
    "subGenre" TEXT,
    "eventType" TEXT NOT NULL,
    "eventDate" DATETIME,
    "eventDateText" TEXT,
    "price" TEXT,
    "url" TEXT NOT NULL,
    "imageUrl" TEXT,
    "scrapedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "marketPrice" INTEGER,
    "marketPriceText" TEXT,
    "marketUrl" TEXT,
    "marketSource" TEXT,
    "marketCheckedAt" DATETIME,
    "highlights" TEXT,
    "hasLottery" BOOLEAN,
    "officialUrl" TEXT
);

-- CreateIndex
CREATE INDEX "Item_genre_idx" ON "Item"("genre");

-- CreateIndex
CREATE INDEX "Item_eventDate_idx" ON "Item"("eventDate");

-- CreateIndex
CREATE UNIQUE INDEX "Item_source_sourceId_key" ON "Item"("source", "sourceId");

-- CreateTable（自前アクセス解析イベント。追加のみ＝既存に無影響）
CREATE TABLE IF NOT EXISTS "Event" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "value" TEXT,
    "data" TEXT,
    "path" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Event_name_createdAt_idx" ON "Event"("name", "createdAt");
