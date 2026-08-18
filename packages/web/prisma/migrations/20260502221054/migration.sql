-- AlterTable
ALTER TABLE "Chat" ADD COLUMN     "environmentVariables" JSONB;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "repoEnvironmentVariables" JSONB;
