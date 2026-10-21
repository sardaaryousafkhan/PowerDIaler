# First real tenant — RBAC onboarding gate (C1)

Run before cutting `RBAC_ENFORCE_ADMIN_PERMS` to hard 403 for that tenant.

## 1. Capture cross-check (required)

`AuditLog.createdAt` may be epoch **milliseconds** (local SQLite). Do not use `datetime('now')` string compare against ms.

```sql
-- Postgres (adjust cast if createdAt is timestamptz)
SELECT m."orgRole" AS actor_role, COUNT(*) AS c
FROM "AuditLog" a
JOIN "Membership" m
  ON m."userId" = a."actorUserId"
 AND m."organizationId" = a."organizationId"
WHERE a."createdAt" >= NOW() - INTERVAL '90 days'
GROUP BY m."orgRole"
ORDER BY c DESC;
```

| Result | Meaning |
|--------|---------|
| `ORG_ADMIN` count > 0 | Capture works; restricted-action zeros are meaningful |
| `ORG_ADMIN` absent; `ORG_OWNER`/`AGENT` present | Admins never acted as Admin in-window — or dual-role smoke; treat C1 **inconclusive** |
| Almost no rows | Pipeline gap — C1 invalid |

If inconclusive → **log-only mode ≥ 2 weeks** (log would-be 403, do not return 403) before enforce.

## 1b. Do admin-only users exist? (required)

Distinguishes “no Admin ever acted” from “no Admin-only subjects exist.”

```sql
-- Prisma table/column names (Postgres)
SELECT u.id, u.email, COUNT(a.id) AS actions
FROM "User" u
WHERE EXISTS (
  SELECT 1 FROM "Membership" m
  WHERE m."userId" = u.id AND m."orgRole" = 'ORG_ADMIN' AND m.status = 'ACTIVE'
)
AND NOT EXISTS (
  SELECT 1 FROM "Membership" m2
  WHERE m2."userId" = u.id AND m2."orgRole" = 'ORG_OWNER' AND m2.status = 'ACTIVE'
)
LEFT JOIN "AuditLog" a ON a."actorUserId" = u.id
GROUP BY u.id, u.email
ORDER BY actions DESC, u.email;
```

| Result | Action |
|--------|--------|
| Zero rows | No admin-only subjects; 2-week log-only window as planned is OK |
| Rows with `actions = 0` | Admin-only subjects exist but never appear as actors → **capture gap** — fix capture **before** first tenant cutover |
| Rows with `actions > 0` | Capture works for Admins; use action breakdown for C1 risk table |

## 2. Restricted-action table

Fill Admin × {Billing, Integrations, Invite, Global settings} from action logs (not permission grants).

## 3. Hierarchy log-only week

After `managedByAdminId` exists: one week log-only on cross-scope attempts, then enforce.

## 3b. Log-only must alarm (required)

Log-only without alerting is theater.

| Control | Requirement |
|---------|-------------|
| Counter | Increment on every would-be Admin 403 while in log-only (`rbac.log_only_denied` or metrics counter) |
| Threshold | Alert RBAC / on-call if **> 5** would-be Admin 403s in **24h** |
| Sink | Same channel as other prod alerts (PagerDuty / Slack / email — pick one before first tenant) |
| Exit | Do not exit log-only until threshold stays quiet for the soak window **or** each spike is triaged as intentional |

## 4. Comms

One paragraph to Admins + demote/reassignment policy link.
