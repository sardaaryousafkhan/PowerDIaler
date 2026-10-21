-- AlterTable
ALTER TABLE "DncEntry" ADD COLUMN "createdByUserId" TEXT;

-- CreateIndex
CREATE INDEX "DncEntry_createdByUserId_idx" ON "DncEntry"("createdByUserId");
