# Migrating from SQLite to multi-tenant / Postgres

## What the backfill does

`apps/api/src/lib/backfillMultitenant.ts` (also run on API startup):

1. Ensures Starter `Plan`
2. Creates `default-workspace` Organization
3. Attaches campaigns / DNC / CRM rows with null `organizationId`
4. Creates ACTIVE memberships for existing users (ORG_OWNER for platform OWNER, else ORG_ADMIN)

Safe to re-run.

```bash
cd apps/api
pnpm exec tsx src/lib/backfillMultitenant.ts
```

## Moving to Postgres

1. Export or keep a backup of `apps/api/prisma/dev.db`.
2. Change `datasource.provider` in `schema.prisma` to `postgresql`.
3. Set `DATABASE_URL` to your Postgres URL.
4. `pnpm exec prisma db push` (or `migrate dev` once you adopt migrations).
5. Re-import data or re-run campaign CSV import into the new org.
6. Run backfill again.

## Notes

- Local demo may keep SQLite; production should use Postgres + Redis.
- `--accept-data-loss` on `db push` can drop incompatible columns/tables — always backup first.
