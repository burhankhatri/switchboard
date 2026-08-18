-- CreateTable
CREATE TABLE "WorkspaceConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "baseUrl" TEXT,
    "authType" TEXT,
    "authParam" TEXT,
    "mcpUrl" TEXT,
    "encryptedSecret" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkspaceConnection_workspaceId_idx" ON "WorkspaceConnection"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceConnection_workspaceId_slug_key" ON "WorkspaceConnection"("workspaceId", "slug");

-- AddForeignKey
ALTER TABLE "WorkspaceConnection" ADD CONSTRAINT "WorkspaceConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
