-- AlterTable
ALTER TABLE "Chat" ADD COLUMN     "sharedToWorkspaceAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "WorkspaceMember" ADD COLUMN     "lastSeenAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WorkspaceEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actorUserId" TEXT,
    "jobId" TEXT,
    "runId" TEXT,
    "chatId" TEXT,
    "widgetId" TEXT,
    "summary" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceWidget" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdVia" TEXT NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "sourceChatId" TEXT,
    "sourceMessageId" TEXT,
    "sourceJobId" TEXT,
    "sourceRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceWidget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkspaceEvent_workspaceId_createdAt_idx" ON "WorkspaceEvent"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkspaceWidget_workspaceId_position_idx" ON "WorkspaceWidget"("workspaceId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceWidget_workspaceId_key_key" ON "WorkspaceWidget"("workspaceId", "key");

-- CreateIndex
CREATE INDEX "Chat_workspaceId_sharedToWorkspaceAt_idx" ON "Chat"("workspaceId", "sharedToWorkspaceAt");

-- AddForeignKey
ALTER TABLE "WorkspaceEvent" ADD CONSTRAINT "WorkspaceEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceEvent" ADD CONSTRAINT "WorkspaceEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceWidget" ADD CONSTRAINT "WorkspaceWidget_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceWidget" ADD CONSTRAINT "WorkspaceWidget_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceWidget" ADD CONSTRAINT "WorkspaceWidget_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

