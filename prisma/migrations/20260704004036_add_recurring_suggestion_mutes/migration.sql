-- CreateTable
CREATE TABLE "RecurringSuggestionMute" (
    "id" TEXT NOT NULL,
    "merchantKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "RecurringSuggestionMute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecurringSuggestionMute_userId_merchantKey_key" ON "RecurringSuggestionMute"("userId", "merchantKey");

-- AddForeignKey
ALTER TABLE "RecurringSuggestionMute" ADD CONSTRAINT "RecurringSuggestionMute_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
