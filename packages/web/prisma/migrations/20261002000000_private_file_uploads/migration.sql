CREATE TABLE "FileUpload" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "scopeId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "contentType" TEXT NOT NULL,
  "objectPath" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  "claimToken" TEXT,
  "claimUntil" TIMESTAMP(3),
  CONSTRAINT "FileUpload_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "WorkspaceAsset" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "uploadId" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkspaceAsset_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FileUpload_objectPath_key" ON "FileUpload"("objectPath");
CREATE INDEX "FileUpload_expiresAt_idx" ON "FileUpload"("expiresAt");
CREATE INDEX "FileUpload_userId_scope_scopeId_idx" ON "FileUpload"("userId", "scope", "scopeId");
CREATE UNIQUE INDEX "WorkspaceAsset_uploadId_key" ON "WorkspaceAsset"("uploadId");
CREATE UNIQUE INDEX "WorkspaceAsset_workspaceId_path_key" ON "WorkspaceAsset"("workspaceId", "path");
ALTER TABLE "WorkspaceAsset" ADD CONSTRAINT "WorkspaceAsset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceAsset" ADD CONSTRAINT "WorkspaceAsset_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "FileUpload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
