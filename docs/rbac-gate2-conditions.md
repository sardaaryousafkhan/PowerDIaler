# RBAC Gate 2 — conditions (pre-build)

**Status:** Gate 2 unlocked. C1 capture = **inconclusive** (log-only on first tenant). C3 confirmed + team-size audit fields. C7 decision table posted for review — **guards blocked until R1–R3 signed**.  
**UI:** Blocked until isolation green.  
**Live-call panel:** Out of scope.

---

## Locked from Gate 1

| Decision | Value |
|----------|--------|
| Surface | Role-filtered **app nav rail** only |
| Live-call panel | Untouched |
| Admin CRM | `crm_view` team read; `crm_manage` = integration Owner-only; team import only |
| Missing views | **Drop** (roadmap only — no stubs) |
| Sequence | Backend + isolation **before** menu flag |

---

## Small notes — accepted

| Note | Decision |
|------|----------|
| Profile | Owner profile = `self`; company = `company_settings` |
| Invite vs role | `members_invite` / `members_change_role` (Owner); `members_manage` alias |
| Campaigns | `ownedByAdminMembershipId`; cross-team mutate = Owner-only |
| Recordings | `recordings_view_self` real key; UI dropped this pass |
| Menu order | Single ordered config + role filters + order test |

---

## C1 — Breaking change · action-log audit (corrected)

**Not** permission-grant tables — those are decorative for Admins today (bypass). Query **who actually performed** soon-to-be-removed actions.

### Result — this workspace (local `apps/api/prisma/dev.db`)

| Finding | Detail |
|---------|--------|
| Environment | **No hosted prod tenants** — SQLite demo/local only |
| ORG_ADMIN memberships | 13 (smoke/perf) |
| **Capture cross-check** (org-matched actor role, all time) | `ORG_OWNER` 167 · `AGENT` 3 · **`ORG_ADMIN` 0** |
| Capture working? | **Partial:** OWNER + AGENT appear → logging works. **No org-matched ORG_ADMIN actor ever.** Several “Admin” emails also hold `ORG_OWNER` elsewhere and only acted as Owner. |
| 90d SQL bug | `createdAt` stored as **epoch ms**; `datetime('now','-90 days')` returned 0 rows — fixed guidance in first-tenant checklist |
| Restricted actions | Owners only in org-matched logs |

**C1 verdict for this phase:** Accepted as **no prod tenants**, but Admin usage signal is **inconclusive** (no ORG_ADMIN actor captured). First real tenant: mandatory capture re-check + **log-only ≥ 2 weeks** if Admin still never appears; hierarchy week is log-only then enforce ([`rbac-first-tenant-checklist.md`](./rbac-first-tenant-checklist.md)).

**Cross-admin:** remains **unknown**, not unused. No retroactive measure after hierarchy lands.

**Impact table (local):** not meaningful for real Admins — smoke dual-role pollution.

```sql
-- Postgres prod — ORG_ADMIN actors only, action history
SELECT a.action, COUNT(*) AS event_count, COUNT(DISTINCT a."actorUserId") AS distinct_admins
FROM "AuditLog" a
JOIN "Membership" m
  ON m."userId" = a."actorUserId" AND m."organizationId" = a."organizationId"
 AND m."orgRole" = 'ORG_ADMIN' AND m."status" = 'ACTIVE'
WHERE a."createdAt" >= NOW() - INTERVAL '90 days'
  AND a.action IN (
    'invite.created','members.created','members.removed','members.permissions_updated',
    'org.settings_updated','integrations.preference_updated','integrations.secret_updated',
    'dnc.remove','campaign.deleted','campaign.assignments_updated'
  )
GROUP BY a.action ORDER BY event_count DESC;
```

**Rollout:** Suggest **2-week** runway between “enforce flag on + compat” and “compat removal” if ≥20 Admins; **1 week** if smaller (this local base is smoke-sized → 1 week OK).  
**Comms:** One paragraph to Admins + link to demote/reassignment policy — required even when audit shows zero usage.  
**Rollback:** `permissionModelVersion` / `RBAC_ENFORCE_ADMIN_PERMS` must drive **backend** `requirePermission` + scope (see C6/C7) — not the menu flag.

**[OWNER]** Confirm: accept local C1 as “no prod tenants” for this phase, and set rollout date when first real tenant goes live.

---

## C2 — Empty team · ✅ approved

Allow menus; empty state: “No Users assigned yet — contact your Owner” with **mailto / support link** to Owner contact (not text-only).

---

## C3 — Demote Admin · ✅ confirmed (yes / yes + clarifications)

| Question | Answer |
|----------|--------|
| Owner-direct as target | **YES** — first-class option |
| Block only if refuse reassignment | **YES** — forced choice, not pre-emptive dead-end |

### Modal copy (ship this)

- Title: Demote Admin  
- Body: “Reassign these N Users to:”  
- Controls: `[dropdown of other Admins]` \| **`[Owner direct]`**  
- If dropdown empty → only Owner-direct remains; Owner may cancel; cannot demote without choosing.  
- Error if they try to submit without choice: **“Demotion requires reassignment. Choose another Admin or accept reassignment to yourself.”** — not “Blocked.”

### Scope contract (before demote code)

`managedByAdminId = null` means **Owner-direct team**.

Team scope for actor:

```
Users where managedByAdminId = <actor.membershipId>
  OR (managedByAdminId IS NULL AND actor.orgRole = ORG_OWNER)
```

Owner always sees Owner-direct Users. Admins never see `managedByAdminId IS NULL` Users unless they are Owner.

### Transaction + audit

1. Single transaction: reassign every User + move campaign ownership + set demoted role to AGENT.  
2. On any failure → full rollback; **no** audit row.  
3. **After commit**, write:

```json
{
  "event": "members.admin_demoted",
  "actorId": "<owner>",
  "demotedAdminId": "<admin>",
  "reassignments": [
    { "userId": "u1", "previousManagerId": "<admin>", "newManagerId": "<otherAdmin>" },
    { "userId": "u2", "previousManagerId": "<admin>", "newManagerId": null }
  ],
  "previousTeamSize": 2,
  "newTeamSize": 0,
  "timestamp": "<iso>"
}
```

`newManagerId: null` = Owner-direct.  
Invariant: `previousTeamSize - newTeamSize === reassignments.length` (for full demote clear-out). Audit readers refuse display if corrupt.

---

## C4 — Keys · ✅ approved

Keep all existing keys. Add: `members_invite`, `members_change_role`, `assign_user_to_admin`, `dnc_delete`, `reports_export`, `crm_view`, `recordings_view_self`, `audit_view`. Do not reuse `crm_manage` for team read.

---

## C5 — Audit immutability · ✅ approved

DB REVOKE UPDATE/DELETE (Postgres) + SQLite trigger; app create-only; filtered read by role. Test: app user UPDATE raises.

---

## C6 — Flag sequencing · ✅ approved + correction

| Step | What |
|------|------|
| 1 | Backend schema + keys + gates; Admins on compat (`permissionModelVersion=1` or enforce flag off) |
| 2 | Isolation suite green in staging |
| 3 | Menu flag (`rbacNav`) internal |
| 4 | Cutover enforce / version=2 |
| 5 | Compat removal after **1–2 weeks** (separate ticket) |

**Correction:** `permissionModelVersion` (and/or `RBAC_ENFORCE_ADMIN_PERMS`) is read **server-side on every** `requirePermission` / scope check. Rolling version back reverts **backend** enforcement without redeploy if stored on Membership/org. Env-only flag = redeploy to roll back — prefer **DB-backed version** for true rollback; env flag OK for staging kill-switch.

---

## C7 — Bypass removal · decision table before guards

- Inventory: [`rbac-c7-bypass-inventory.md`](./rbac-c7-bypass-inventory.md)  
- **Decision table (review now):** [`rbac-c7-decision-table.md`](./rbac-c7-decision-table.md)  
- Isolation skeleton: `apps/api/src/rbac/isolation/` · `pnpm test:rbac` · CI `.github/workflows/rbac-isolation.yml`

**R1–R3** (integrations read, org settings split, CRM re-keys) must be signed off before any guard PR.

---

## Gate unlock checklist

| Item | Status |
|------|--------|
| C1 no-prod + capture → **inconclusive** for real Admins | ✅ posted |
| C1 first-tenant checklist + log-only week | ✅ [`rbac-first-tenant-checklist.md`](./rbac-first-tenant-checklist.md) |
| Decision table R1–R3 + E01–E12 | ⏳ **blocks guards** |
| Isolation suite skeleton in CI | ✅ |
| C2–C6 | ✅ |
| C3 audit shape + team sizes | ✅ |
| Guards / schema / bypass removal | Blocked on decision-table approval |
| UI menu | Blocked until isolation green |

---

## Roadmap (dropped menus)

Invoices, Recordings UIs, Business Hours, Number Pool, Per-Admin/User reports, Webhooks/API keys UI, Compliance policy pages, System Status, My callbacks / DNC request queue.
