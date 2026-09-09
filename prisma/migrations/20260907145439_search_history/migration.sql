-- CreateTable
CREATE TABLE "search_history" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "guestId" TEXT,
    "keyword" TEXT NOT NULL,
    "searchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "search_history_userId_idx" ON "search_history"("userId");

-- CreateIndex
CREATE INDEX "search_history_guestId_idx" ON "search_history"("guestId");

-- CreateIndex
CREATE UNIQUE INDEX "search_history_userId_keyword_key" ON "search_history"("userId", "keyword");

-- CreateIndex
CREATE UNIQUE INDEX "search_history_guestId_keyword_key" ON "search_history"("guestId", "keyword");

-- AddForeignKey
ALTER TABLE "search_history" ADD CONSTRAINT "search_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
