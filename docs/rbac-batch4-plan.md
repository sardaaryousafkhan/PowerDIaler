# Batch 4 — Flag flip plan (planning only — no code)

**Status:** Planning PR. Do **not** flip `RBAC_ENFORCE_ADMIN_PERMS` until go/no-go below is green.

**Flag source:** env var `RBAC_ENFORCE_ADMIN_PERMS` (`apps/api/src/rbac/enforceFlag.ts`).  
**Rollback:** redeploy with flag unset/`false` (not instant DB toggle).

---

## Go / no-go criteria

| # | Criterion | Status |
|---|-----------|--------|
| G1 | Every **admin-reachable** org endpoint has a matrix-mapped key (no bare Admin bypass dependence) | **NO-GO** — see remaining list |
| G2 | `members_change_role` re-key on PATCH `/admin/access/users/:id` + DELETE `/org/members/:id` (and any role path still on `members_manage`) | **NO-GO** — deferred from Batch 3; **must land before flag flip** (owner: Batch 4 prep PR) |
| G3 | **B4-3** staging smoke: `RBAC_ENFORCE_ADMIN_PERMS=true`, Admin hits each guarded endpoint, assert §1 / inventory expected outcome | Defined below; not run yet |
| G4 | **B4-1** CI tripwire: suite asserts flag is `true` | **GO** (Batch 1) |
| G5 | Runbook documents env-var rollback = redeploy | This doc |

**Bypass removal** (`orgAccess.requirePermission` Admin short-circuit) ships **only when G1 remaining list is empty**.

---

## Endpoint count (post Batch 3)

Approximate inventory (excludes `auth` / `me` / machine webhooks):

| Bucket | Count |
|--------|------:|
| Batch1-style gated (flag-aware) | ~17 |
| Remaining admin-reachable (legacy `requirePermission` / `requireOrg` / `enforceFunctionAccess` / campaign access) | **~24** |
| Prior “46” framing | C7 (12) + related gates + campaign/integration surface ≈ 40–46 |

**Remaining endpoints (Batch 4 prep / Batch N+1 — must be empty before bypass removal):**

1. `PATCH /admin/access/users/:id` — re-key `members_change_role` (+ team scope)
2. `DELETE /org/members/:id` — Owner / demote + `members_change_role`
3. `PUT /campaigns/:id/assignments` — `members_manage` + ownership
4. `GET /org/audit-logs` — `audit_view` + team filter
5. `PATCH /org/settings` — `company_settings` (latent Owner-only)
6. `GET /org/billing` — `billing_view` (latent Owner-only)
7. `POST /campaigns` — `campaign_create` + team ownership stamp
8. `GET /campaigns/:id` — `campaign_view` + scope
9. `DELETE /campaigns/:id` — `campaign_delete` + owned
10. `POST /campaigns/:id/contacts` — `contact_import` + owned
11. `POST /campaigns/:id/start|pause|resume` — keys + owned
12. `POST /campaigns/:id/sms-template` — revisit key + owned
13. `POST /campaigns/:id/agent-disposition` — `campaign_dial` / notes
14. `POST /campaigns/:id/agent-skip` — `campaign_dial`
15. `POST /campaigns/:id/sms` — `sms_broadcast` scope
16. `PATCH .../contacts/:contactId/notes` — `campaign_notes`
17. `GET /campaigns/:id/attempts` — `campaign_view` + scope
18. `GET .../voicemail-recording` / `voice-instructions` — token or scoped auth
19. `DELETE /dnc/:e164` — `dnc_delete` + Owner-entry rule
20. `PUT /integrations/preference` — `integrations_manage`
21. `PUT /integrations/setup/:provider` — `integrations_manage`
22. Related: any other `enforceFunctionAccess` campaign path not listed

`GET /org/settings` is shape-gated (E03) under flag-off/on without Batch1 key — treat as done for C7; confirm no Admin bypass hole remains when short-circuit is removed.

---

## B4-3 staging smoke (runbook)

**Location:** manual runbook (this section) until automated in `.github/workflows/` as a staging job.  
**Owner:** release engineer / whoever flips the flag (fill name at flip time).

1. Deploy staging API with `RBAC_ENFORCE_ADMIN_PERMS=true` (and `DEMO_MODE` off if using real integrations).
2. Seed Owner, Admin A + team, Admin B + team, Agent.
3. As Admin, hit each **already-gated** endpoint (Batches 1–3) and assert target outcome per C7 table + invite 403s.
4. As Admin, spot-check **remaining** list — expect current (possibly bypass) behavior until those PRs land; do **not** remove bypass until remaining is empty.
5. Fill break-log; empty bugs → proceed to bypass-removal PR.

---

## Rollback

1. Set `RBAC_ENFORCE_ADMIN_PERMS=false` (or unset) in the staging/prod env.
2. **Redeploy** the API process (env var is read at request time from `process.env`, but platform env changes typically require process restart).
3. Confirm isolation CI still runs with flag **on** (tripwire) — prod/staging flag-off does not change CI.

---

## Suggested sequence before flip

1. Prep PR(s): remaining ~24 endpoints + `members_change_role` re-key.
2. Isolation tests per endpoint (same rules as Batches 1–3).
3. Staging smoke (B4-3).
4. Flip flag on staging → soak.
5. Bypass-removal PR (touch `orgAccess.ts`) — **last**.
6. Flip prod + redeploy; rollback = redeploy flag-off.
