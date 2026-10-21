-- Batch 1: Admin→User hierarchy + CRM assigned user (SQLite-compatible notes).
-- Applied via `prisma db push` in local/demo; this file documents the intended DDL.

-- ALTER TABLE "Membership" ADD COLUMN "managedByAdminId" TEXT;
-- CREATE INDEX "Membership_managedByAdminId_idx" ON "Membership"("managedByAdminId");
-- ALTER TABLE "CrmContact" ADD COLUMN "assignedUserId" TEXT;
-- CREATE INDEX "CrmContact_assignedUserId_idx" ON "CrmContact"("assignedUserId");
-- ALTER TABLE "CrmActivity" ADD COLUMN "assignedUserId" TEXT;
-- CREATE INDEX "CrmActivity_assignedUserId_idx" ON "CrmActivity"("assignedUserId");
