-- CreateTable
CREATE TABLE "Item" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "genre" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventDate" DATETIME,
    "eventDateText" TEXT,
    "price" TEXT,
    "url" TEXT NOT NULL,
    "imageUrl" TEXT,
    "scrapedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "Item_genre_idx" ON "Item"("genre");

-- CreateIndex
CREATE INDEX "Item_eventDate_idx" ON "Item"("eventDate");

-- CreateIndex
CREATE UNIQUE INDEX "Item_source_sourceId_key" ON "Item"("source", "sourceId");
