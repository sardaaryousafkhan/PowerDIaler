# RBAC Batch 1 PR

## Summary

- **E03** `GET /org/settings` — role-shaped response (always on)
- **E04** `GET /integrations` — Owner-only when `RBAC_ENFORCE_ADMIN_PERMS=true`
- **E09–E12** CRM gates — `crm_manage` / `crm_view` + write-time team scope when enforce on
- Isolation Tests **A**, **B**, **R1** + Agent E10/E12 — **passing** under `pnpm test:rbac`
- **Does not** modify `orgAccess.ts` Admin bypass (Batch 4)

## Items 1–5 (resolved in this PR)

### 1. E10 vs E12 Agent `crm_view` scope

**Rule:** Agent is granted `crm_view` at **self** scope only.

- **E10** `GET /crm/activities` is a **team** list → Agent **403** (`agent_team_list_denied`) even though the key is `crm_view`.
- **E12** `POST /crm/activities/log` is a **self** write → Agent **200** (defaults `assignedUserId` to self).

Proven by tests: `E10 — Agent GET…403` and `E12 — Agent POST…200` in `batch1.isolation.test.ts`.

### 2. `crm_view` on writes

**Choice (b):** Keep `crm_view` for both read (team) and write (self/team). Documented path to split into dedicated write keys in a future key version. Do not invent `crm_upsert_team` in Batch 1.

When flag **off**, writes still use legacy `crm_manage` so Agents do not gain new write access early.

### 3. E11 `assignedUserId`

**Choice (a), flag-gated:** When `RBAC_ENFORCE_ADMIN_PERMS=true`, Admin **must** send `assignedUserId`; missing → 403; cross-team → 403 + audit. When flag **off**, field optional (compat — no client break until Batch 4).

**Client migration (at Batch 4 / enforce flip):** CRM upsert/log callers must pass `assignedUserId` for Admin sessions. No in-repo web upsert callers today (`CrmPage` only lists/status).

### 4. E03 `plan` / Admin UI

**Grep:** Admin UI does **not** read `org.settings().plan`. `OrgBillingPage` uses `/org/billing`. `OrgSettingsPage` uses name / smsPerMinute / timezone only.

**Decision:** Keep **`plan` and `subscription` Owner-only**. Admin exact shape:

```json
{
  "id": "...",
  "name": "...",
  "slug": "...",
  "settings": { "timezone": "America/New_York" },
  "smsPerMinute": 30,
  "preferredIntegrationKey": "twilio"
}
```

### 5. E09 / CI flag state

**Choice:** CI and `pnpm test:rbac` run with **`RBAC_ENFORCE_ADMIN_PERMS=true`** so tests assert target behavior. Prod stays flag-off until Batch 4.

## Non-blocking notes

- **E06 GV bridge-health:** Currently auth-sub only (any authenticated user; Zoom path uses `requireOrg`). Gating with `integrations_manage` + `requireOrg` in Batch 2/3 closes a **real** gap (weaker than org membership today for GV).
- **E07 Batch 3:** Add Admin A cannot see Admin B team DNC.
- **E08 Batch 3 decision:** Owner-created campaigns vs Admin-owned only — decide at Batch 3 open.
- **E07 confirm:** Admin sees team DNC + Owner DNC, not other Admins’ DNC.

## Shared helpers (new)

| File | Role |
|------|------|
| `apps/api/src/rbac/enforceFlag.ts` | Flag reader |
| `apps/api/src/rbac/permissionGate.ts` | Batch-1 gate + deny audit (no bypass change) |
| `apps/api/src/rbac/orgSettingsShape.ts` | E03 shapes |
| `apps/api/src/rbac/teamScope.ts` | `managedByAdminId` team checks |
| `packages/shared` | add `crm_view` key |
| Prisma | `Membership.managedByAdminId`, `CrmContact/CrmActivity.assignedUserId` |

## Test plan

- [x] `pnpm test:rbac` green (Tests A, B, R1 + E09–E12)
- [ ] Staging: enforce flag on, menu flag off
- [ ] Confirm Owner still loads Integrations + CRM status
