-- AlterTable
ALTER TABLE "User" ADD COLUMN     "githubLogin" TEXT;

-- AlterTable
ALTER TABLE "Workspace" ALTER COLUMN "agent" SET DEFAULT 'claude-code';
