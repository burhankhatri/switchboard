-- CreateTable
CREATE TABLE "ChatApproval" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "count" INTEGER,
    "campaign" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "ChatApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatApproval_chatId_status_idx" ON "ChatApproval"("chatId", "status");

-- AddForeignKey
ALTER TABLE "ChatApproval" ADD CONSTRAINT "ChatApproval_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
