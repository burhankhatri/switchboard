-- Agent-proposed jobs wait for a human before they can dispatch.
-- Nullable and additive: existing rows are back-filled as approved, because
-- every job that exists today was created by a person through the form.
ALTER TABLE "ScheduledJob" ADD COLUMN "approvedAt" TIMESTAMP(3);

UPDATE "ScheduledJob" SET "approvedAt" = "createdAt" WHERE "approvedAt" IS NULL;
