CREATE TABLE "HomeOperation" (
 "id" TEXT NOT NULL PRIMARY KEY, "workspaceId" TEXT NOT NULL REFERENCES "Workspace"("id") ON DELETE CASCADE,
 "userId" TEXT NOT NULL, "requestKey" TEXT NOT NULL, "kind" TEXT NOT NULL, "prompt" TEXT NOT NULL,
 "targetId" TEXT, "targetVersion" TEXT, "status" TEXT NOT NULL DEFAULT 'queued', "stage" TEXT NOT NULL DEFAULT 'Waiting to start',
 "sequence" INTEGER NOT NULL DEFAULT 0, "events" JSONB NOT NULL DEFAULT '[]', "plan" JSONB, "context" JSONB, "runtime" JSONB, "generationComplete" BOOLEAN NOT NULL DEFAULT false, "contextVersion" TEXT,
 "cursor" INTEGER NOT NULL DEFAULT 0, "receipts" JSONB NOT NULL DEFAULT '[]', "dismissed" JSONB NOT NULL DEFAULT '[]',
 "error" TEXT, "leaseToken" TEXT, "leaseUntil" TIMESTAMP(3), "attempts" INTEGER NOT NULL DEFAULT 0,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "HomeOperation_workspaceId_requestKey_key" ON "HomeOperation"("workspaceId", "requestKey");
CREATE INDEX "HomeOperation_status_leaseUntil_idx" ON "HomeOperation"("status", "leaseUntil");
CREATE INDEX "HomeOperation_workspaceId_createdAt_idx" ON "HomeOperation"("workspaceId", "createdAt");
CREATE TABLE "HomeInsight" (
 "id" TEXT NOT NULL PRIMARY KEY, "workspaceId" TEXT NOT NULL REFERENCES "Workspace"("id") ON DELETE CASCADE,
 "key" TEXT NOT NULL, "title" TEXT NOT NULL, "detail" TEXT NOT NULL, "status" TEXT NOT NULL, "kind" TEXT NOT NULL,
 "evidence" JSONB NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "HomeInsight_workspaceId_key_key" ON "HomeInsight"("workspaceId", "key");
CREATE TABLE "HomeDigest" (
 "id" TEXT NOT NULL PRIMARY KEY, "workspaceId" TEXT NOT NULL REFERENCES "Workspace"("id") ON DELETE CASCADE,
 "chatId" TEXT NOT NULL, "version" TEXT NOT NULL, "content" JSONB NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "HomeDigest_workspaceId_chatId_key" ON "HomeDigest"("workspaceId", "chatId");
