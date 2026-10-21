-- Reverse of migration.sql (manual; Prisma does not auto-apply down).
-- Drops the column only — no cascade, no row deletes.
-- SQLite: ADD COLUMN reverse requires table rebuild; Prisma migrate reset
-- or recreate-from-schema is the supported path for local SQLite.
DROP INDEX IF EXISTS "DncEntry_createdByUserId_idx";
-- Postgres:
-- ALTER TABLE "DncEntry" DROP COLUMN "createdByUserId";
