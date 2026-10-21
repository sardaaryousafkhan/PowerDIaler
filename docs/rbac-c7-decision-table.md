# C7 — 12-endpoint decision table (review before guards)

**Status:** Awaiting approval. **Do not add guards until this table is signed off.**  
**Checklist per row (after approval):** `[ ] guard` · `[ ] isolation test` · `[ ] audit verified`

**Scopes:** `tenant` = whole org · `team` = Users where `managedByAdminId = actor` (Owner also includes `managedByAdminId IS NULL`) · `self` = actor only · `—` = N/A (deny)

**Audit on deny:** every 403 from these gates writes `access.denied` with `{ path, requiredPermission, actorId, orgRole }`.

---

## Re-key decisions (must confirm)

| # | Topic | Proposal | Rationale |
|---|--------|----------|-----------|
| R1 | `GET /integrations` | **Admin: 403** + **no menu**. No `integrations_view`. | Matrix: manage is Owner-only; hide > grey/403 UX. Catalog not needed for Admin ops. |
| R2 | `GET /org/settings` | **Split endpoint** (preferred) or **Admin 403 on full payload**. Dial-needed fields (`smsPerMinute`, `preferredIntegrationKey`) stay available via existing org-member-safe path; `settings` JSON + plan/subscription → Owner (`company_settings` / `billing_view`). **Admin menu: no Company Settings.** | Avoid breaking agent dial that already calls this GET; do not grant Admin company JSON. |
| R3 | CRM keys | Reads/ops logging → `crm_view` **team**. Provider status / integration config → `crm_manage` **Owner**. | No connect/disconnect/field-map routes exist under `/crm/*` today — those live under `/integrations/*` (already Owner). |

**Confirm R1–R3 before coding.**

---

## Decision table (the 12)

| ID | Method | Path | Today | New key | Scope | Admin expected | Owner expected | Agent expected | Notes |
|----|--------|------|-------|---------|-------|----------------|----------------|----------------|-------|
| E01 | GET | `/admin/access/users` | `requireOrgAdmin` | `members_manage` | team | 200 team only | 200 all | 403 | Replace bare admin check |
| E02 | GET | `/campaigns/:id/assignments` | `requireOrgAdmin` | `members_manage` | team | 200 if campaign owned | 200 | 403 | Cross-team campaign → 403 |
| E03 | GET | `/org/settings` | `requireOrg` | see **R2** | — / tenant | 403 full *or* filtered | 200 | dial fields only / 200 filtered | Split preferred |
| E04 | GET | `/integrations` | `requireOrg` | `integrations_manage` | tenant | **403** (R1) | 200 | 403 | No Admin read key |
| E05 | GET | `/integrations/setup/:provider` | `requireOrg` | `integrations_manage` | tenant | 403 | 200 | 403 | Secrets surface |
| E06 | GET | `/integrations/*/bridge-health` | `requireOrg` | `integrations_manage` | tenant | 403 | 200 | 403 | Both GV + Zoom |
| E07 | GET | `/dnc` | `requireOrg` | `dnc_manage` | team | 200 team+shared Owner DNC view | 200 all | 403 *or* self-request later | View/add stay `dnc_manage` |
| E08 | GET | `/campaigns` | `requireOrg` + where | `campaign_view` | team / self | 200 owned | 200 all | 200 assigned | Add key + tighten where |
| E09 | GET | `/crm/providers/:provider/status` | `crm_manage` (bypass) | `crm_manage` | tenant | **403** | 200 | 403 | Integration status |
| E10 | GET | `/crm/activities` | `crm_manage` (bypass) | `crm_view` | team | 200 team | 200 all | 403 or self | Re-key |
| E11 | POST | `/crm/contacts/upsert` | `crm_manage` (bypass) | `crm_view` | team | 200 team | 200 | 403 | Operational contact write, not integration manage |
| E12 | POST | `/crm/activities/log` | `crm_manage` (bypass) | `crm_view` | team | 200 team | 200 | self if dialing | Operational activity log |

### Related gates (same PRs, not extra “mystery” keys)

| Path | New key | Scope | Admin |
|------|---------|-------|-------|
| PATCH `/org/settings` | `company_settings` | tenant | 403 |
| GET `/org/billing` | `billing_view` | tenant | 403 |
| POST `/org/invites` | `members_invite` | tenant | 403 |
| GET `/org/invites` | `members_invite` | tenant | 403 |
| POST `/org/members` | `members_invite` | tenant | 403 |
| DELETE `/org/members/:id` | `members_change_role` (+ demote flow) | tenant | 403 |
| PUT `/integrations/preference` | `integrations_manage` | tenant | 403 |
| PUT `/integrations/setup/:provider` | `integrations_manage` | tenant | 403 |
| DELETE `/dnc/:e164` | `dnc_delete` | tenant / team rule | Team-added only; Owner entries → 403 |
| GET `/org/audit-logs` | `audit_view` | tenant / team | Team subset |

---

## Checklist (copy into PR)

```
E01 [ ] guard  [ ] test  [ ] audit
E02 [ ] guard  [ ] test  [ ] audit
E03 [ ] guard  [ ] test  [ ] audit
E04 [ ] guard  [ ] test  [ ] audit
E05 [ ] guard  [ ] test  [ ] audit
E06 [ ] guard  [ ] test  [ ] audit
E07 [ ] guard  [ ] test  [ ] audit
E08 [ ] guard  [ ] test  [ ] audit
E09 [ ] guard  [ ] test  [ ] audit
E10 [ ] guard  [ ] test  [ ] audit
E11 [ ] guard  [ ] test  [ ] audit
E12 [ ] guard  [ ] test  [ ] audit
R1/R2/R3 [ ] signed off
```

---

## First-tenant onboarding gate (C1)

Before cutting enforce for a real tenant:

1. Re-run action-log SQL (epoch-safe: compare `createdAt` as ms or cast).
2. Capture check: `ORG_ADMIN` must appear as org-matched actor on **some** action, or C1 stays inconclusive → **log-only ≥ 2 weeks**.
3. Hierarchy log-only week: enforcement logs would-be 403s, returns success until flip.
