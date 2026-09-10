-- CreateTable
CREATE TABLE "WorkspaceInvite" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "githubLogin" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "invitedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkspaceInvite_githubLogin_idx" ON "WorkspaceInvite"("githubLogin");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceInvite_workspaceId_githubLogin_key" ON "WorkspaceInvite"("workspaceId", "githubLogin");

-- AddForeignKey
ALTER TABLE "WorkspaceInvite" ADD CONSTRAINT "WorkspaceInvite_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceInvite" ADD CONSTRAINT "WorkspaceInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
