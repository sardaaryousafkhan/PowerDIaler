# Batch 4 — Flag flip plan (planning only — no code)

**Status:** Planning PR. Do **not** flip `RBAC_ENFORCE_ADMIN_PERMS` and do **not** open Batch 4 prep code PRs until this plan merges with SF1–SF5 + D1–D8 closed.

**G1 measurable condition:** Bucket A is empty **AND** Bucket B is verified with expected outcomes (staging-smoke green).  
“~24 remaining” is **not** a gate.

---

## SF2 — Exact denominator

### Gate call-site grep (evidence)

```bash
grep -rn 'requirePermission\|enforceFunctionAccess\|requireOrgAdmin\|requireOrg' apps/api/src/routes/ | grep -v test
```

**Raw line count: 86** (includes imports, comments, helper defs, and call sites — not the G1 denominator).

### G1 denominator = HTTP route registrations

```bash
grep -rn 'app\.\(get\|post\|put\|patch\|delete\)(' apps/api/src/routes/ --include='*.ts' | grep -v test | wc -l
# → 61
```

| Bucket | Count | Role |
|--------|------:|------|
| **Done** (Batches 1–3 — flag-aware / shape-gated) | **17** | Already in matrix path |
| **Bucket A** — code changes required | **20** | Must empty before flip |
| **Bucket B** — correctly keyed Owner-only; defaults + bypass | **4** | Must verify 403 after defaults drop + bypass removal |
| **Bucket C** — intentionally out of scope | **20** | Not admin-reachable end-user RBAC |
| **Total** | **61** | Done + A + B + C |

**61 = 17 + 20 + 4 + 20.** Exact. No ≈40–46.

---

## Go / no-go criteria

| # | Criterion | Status |
|---|-----------|--------|
| G1 | Bucket A empty **and** Bucket B verified (Admin 403 / Owner 200) | **NO-GO** — A=20, B unverified |
| G2 / **D1** | `members_change_role` re-key merged + verified (**prep-0**, not bundled) | **NO-GO** |
| G3 | **B4-3** automated staging smoke green on `main` within last 24h | **NO-GO** — workflow not built (SF5) |
| G4 | **B4-1** CI tripwire (`RBAC_ENFORCE_ADMIN_PERMS=true` assert) | **GO** (Batch 1) |
| G5 | Rollback design signed (SF3) | **Pending sign-off** — see SF3 |
| G6 | Bypass-removal PR has own smoke + rollback rehearsal + single-file commit (SF4) | **NO-GO** |

**Bypass removal** (`orgAccess.requirePermission` Admin short-circuit) ships **only when G1 is green**.

---

## SF3 — Rollback design (reconcile with C6)

**C6 preferred:** DB-backed `permissionModelVersion` / enforce flag for instant rollback without redeploy.  
**Current implementation:** env var `RBAC_ENFORCE_ADMIN_PERMS` in `apps/api/src/rbac/enforceFlag.ts` (`process.env`).

### Decision: **(a) Env-var confirmed**

| Field | Value |
|-------|--------|
| Choice | **(a)** Keep env-var; accept redeploy-based rollback |
| Rationale | DB-backed is the better long-term design; converting the flag now is not worth ~2 weeks before the flip. Redeploy rollback is acceptable if rehearsed and deploy is fast (&lt;5 min). If measured deploy &gt;15 min, revisit **(b)**. |
| Failure mode | Flip failure = API redeploy = **N-minute API downtime** for the org (N = measured deploy time). |
| Sign-off line | **Env-var rollback accepted; redeploy-based; rehearsed on [DATE — fill after staging rehearsal].** Owner: [release engineer — fill at Phase 6]. |
| C6 note | Instant DB toggle remains a **post-flip** improvement; not a flip blocker under this sign-off. |

---

## SF4 — Bypass-removal PR (separate, last)

Not bundled with endpoint prep or the flag flip.

| Requirement | Detail |
|-------------|--------|
| Staging smoke before merge | Deploy staging **with bypass removed**; run full Admin smoke on every Bucket A+B endpoint + Owner/Agent spot-check; **zero regression** vs bypass-intact baseline; **post the smoke log** in the PR. |
| Rollback rehearsal | Flip flag → deploy bypass-removed → hit an endpoint that should differ → revert commit/flag → confirm behavior restored. Document **time-to-rollback**. |
| Version pin | **One commit, one file, one message:** `orgAccess: remove ORG_ADMIN short-circuit in requirePermission`. |

---

## SF5 — Automate B4-3 staging smoke (required in Batch 4 prep)

**Flip gate:** staging-smoke workflow **green on current `main` in the last 24h**. Not “runbook owned by [person].”

| Field | Value |
|-------|--------|
| Workflow | `.github/workflows/rbac-staging-smoke.yml` (**to create in prep — not this planning PR**) |
| Triggers | `workflow_dispatch` (manual); also on PRs touching `apps/api/src/rbac/**` or `apps/api/src/lib/orgAccess.ts` |
| Contents | Seed Owner + Admin A/team + Admin B/team + Agent; hit **every Bucket A+B** endpoint as Admin; assert expected outcome; **fail on any mismatch** |
| Also cover | Bucket B after Admin defaults drop; D4 disposition/skip with Agent path |

---

## Bucket A — code changes required (20)

Each row needs: guard ☐ · test ☐ · audit ☐. **G1 fails until all ☐ are checked and Bucket A count = 0.**

| # | Endpoint | Current state | New key | Scope | ☐g | ☐t | ☐a |
|---|----------|---------------|---------|-------|----|----|----|
| **A0** | `PATCH /admin/access/users/:id` | `requirePermission(members_manage)` `adminAccess.ts:98` | **`members_change_role`** | Owner-only for role; team for agent perms | | | |
| **A0b** | `DELETE /org/members/:id` | `requirePermission(members_manage)` `:234` | **`members_change_role`** (+ demote rules) | Owner / demote | | | |
| A1 | `PUT /campaigns/:id/assignments` | `members_manage` `:497` | `members_manage` | **startedBy-only** (D2a) | | | |
| A2 | `GET /org/audit-logs` | `members_manage` `:435` | `audit_view` | **actor OR target** on Admin’s team (D7) | | | |
| A3 | `POST /campaigns` | `enforceFunctionAccess(campaign_create)` | `campaign_create` | stamp `startedByUserId=actor` | | | |
| A4 | `GET /campaigns/:id` | `requireCampaignAccess` (Admin=all) | `campaign_view` | **startedBy-only** (D2a) | | | |
| A5 | `GET /campaigns/:id/attempts` | `requireCampaignAccess` | `campaign_view` | **startedBy-only** (D2a) | | | |
| A6 | `POST /campaigns/:id/contacts` | `contact_import` + campaign access | `contact_import` | **startedBy-only** (D2a) | | | |
| A7 | `DELETE /campaigns/:id` | `campaign_delete` | `campaign_delete` | **startedBy-only** (D2a) | | | |
| A8 | `POST .../start` | `campaign_start` | `campaign_start` | **startedBy-only** (D2a) | | | |
| A9 | `POST .../pause` | `campaign_pause` | `campaign_pause` | **startedBy-only** (D2a) | | | |
| A10 | `POST .../resume` | `campaign_resume` | `campaign_resume` | **startedBy-only** (D2a) | | | |
| A11 | `POST .../sms-template` | `campaign_start` (wrong) | **`campaign_create`** (D3) | **startedBy-only** (D2a) | | | |
| A12 | `POST .../agent-disposition` | `campaign_start` (breaks Agent defaults) | **`campaign_dial`** (D4) | Agent: assigned; Admin: **403 Agent-only write**; Owner: tenant | | | |
| A13 | `POST .../agent-skip` | `campaign_start` | **`campaign_dial`** (D4) | same as A12 | | | |
| A14 | `POST .../sms` | `sms_broadcast` | `sms_broadcast` | **startedBy-only** (D2a) | | | |
| A15 | `PATCH .../contacts/:contactId/notes` | `campaign_notes` | `campaign_notes` | **startedBy-only** / self | | | |
| A16 | `GET .../voicemail-recording` | auth **or** media token | keep **token** (D5a) | short-TTL signed URL; tighten leak | | | |
| A17 | `GET .../voice-instructions` | auth **or** media token | keep **token** (D5a) | same | | | |
| A18 | `DELETE /dnc/:e164` | `dnc_manage` | `dnc_delete` | Admin: team-created only; **Owner entries delete-protected** (D6) | | | |

**Priority-zero:** A0 + A0b ship as **Batch 4-prep-0** alone (D1). Flip cannot proceed unless prep-0 is merged and verified.

---

## Bucket B — correctly keyed Owner-only (4) — verify after defaults drop

Call sites already use the expected Owner-only key. **Env flag flip alone does not 403 Admins today** because (1) `requirePermission` / `enforceFunctionAccess` still Admin-bypass and (2) `defaultPermissionsForOrgRole(ORG_ADMIN)` is currently **allTrue**.

**Prep dependency (one shared change, not per-endpoint):** update Admin defaults so `company_settings`, `billing_view`, `integrations_manage` are **false**; then bypass removal. After that, smoke must assert Admin 403 / Owner 200.

| Endpoint | Current key | Call site | Expected after defaults drop + bypass removal |
|----------|-------------|-----------|-----------------------------------------------|
| `PATCH /org/settings` | `company_settings` | `adminAccess.ts:361` | Admin **403**; Owner **200** |
| `GET /org/billing` | `billing_view` | `adminAccess.ts:409` | Admin **403**; Owner **200** |
| `PUT /integrations/preference` | `integrations_manage` | `integrations.ts:389` (`enforceFunctionAccess`) | Admin **403**; Owner **200** |
| `PUT /integrations/setup/:provider` | `integrations_manage` | `integrations.ts:578` | Admin **403**; Owner **200** |

**Verified as correctly_gated (not missing_gate):** each already names the Owner-only key. None moved to Bucket A for missing key — they stay Bucket B for **defaults + bypass verification**.

Add all four to staging-smoke suite (SF5 / D8).

---

## Bucket C — intentionally out of scope (20)

Not “admin-reachable end-user RBAC” for G1. Enumerated so 61 = A+B+C+Done is auditable.

| File | Endpoints |
|------|-----------|
| `auth.ts` (10) | `GET /auth/me`, `POST /auth/register-company`, `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `POST /auth/accept-invite`, `POST /auth/password-reset/request`, `POST /auth/password-reset/confirm`, `GET /auth/google`, `GET /auth/google/callback` |
| `me.ts` (5) | `PATCH /me/profile`, `POST /me/password`, `GET /me/preferences`, `PATCH /me/preferences`, `GET /me/dashboard` |
| `webhooks.ts` (3) | `POST /webhooks/twilio/voice`, `POST /webhooks/twilio/sms`, `POST /webhooks/vonage/voice` |
| `bridgeWebhooks.ts` (2) | `POST /webhooks/bridge/voice`, `POST /webhooks/bridge/sms` |

Machine auth / self-profile / signup. No Admin bypass inventory obligation for G1.

---

## Done — Batches 1–3 (17)

| Endpoint | Notes |
|----------|--------|
| `GET /admin/access/users` | E01 |
| `GET /campaigns/:id/assignments` | E02 |
| `GET /org/settings` | E03 shape |
| `GET /integrations` | E04 |
| `GET /integrations/setup/:provider` | E05 |
| `GET …/google_voice/bridge-health` | E06 |
| `GET …/zoom_phone/bridge-health` | E06 |
| `GET /dnc` | E07 |
| `POST /dnc` | stamps `createdByUserId` |
| `GET /campaigns` | E08 startedBy-only |
| `GET /crm/providers/:provider/status` | E09 |
| `GET /crm/activities` | E10 |
| `POST /crm/contacts/upsert` | E11 |
| `POST /crm/activities/log` | E12 |
| `POST /org/members` | `members_invite` |
| `POST /org/invites` | `members_invite` |
| `GET /org/invites` | `members_invite` |

---

## Endpoint decisions D1–D8

### D1 — `members_change_role` is priority-zero

**Flip cannot proceed unless D1 is merged and verified. This is the privilege escalation vector and is not bundled with other endpoint work.**

- **Batch 4-prep-0:** re-key `PATCH /admin/access/users/:id` + `DELETE /org/members/:id` to `members_change_role`. Standalone PR.
- Tests: Owner-can, Admin-cannot, Agent-cannot, **no self-promote path**.
- **Batch 4-prep-1…N:** everything else in Bucket A.

### D2 — Campaign detail scope = **(a) startedBy-only uniformly**

Applies to: `GET /campaigns/:id`, `GET …/attempts`, `POST …/contacts`, `PUT …/assignments`, `DELETE /campaigns/:id`, `POST …/start|pause|resume`, `POST …/sms`, `POST …/sms-template`, and list already (E08).

**Consequence (accepted):** Admin A **cannot** see or control a campaign Owner started and assigned to A’s User u1. Same as E08 deferral.

**Tracked as E08-deferred;** assigned-to-team semantics require a **future PR**. Do **not** mix list=startedBy with detail=assigned (direct-URL bypass).

### D3 — `POST …/sms-template` key = **`campaign_create`**

Reuse `campaign_create` + startedBy ownership. Not `campaign_start`, not a new key.

### D4 — Disposition / skip role matrix

| Role | `POST …/agent-disposition` | `POST …/agent-skip` |
|------|---------------------------|---------------------|
| **Agent** | **200** if assigned to campaign; key **`campaign_dial`** | **200** same |
| **Admin** | **403** — dialing write is **Agent-only** | **403** |
| **Owner** | **200** tenant (ops override) | **200** |

**Rationale:** Today these wrongly use `campaign_start` (Agent default = false → dialing break risk). Highest test coverage in the batch. Re-key to `campaign_dial` before flip.

### D5 — Voicemail / voice-instructions = **(a) Token**

Short-TTL signed URL (`campaignMediaToken`); no permission header required at `<audio src>` fetch time.

**Pre-existing finding:** Current code allows `req.auth?.sub` **OR** token (`campaigns.ts` ~328–347). Anyone with the URL can fetch audio — **voice recording leak**, independent of RBAC. Fix pattern: (a) short-TTL token only (drop unauthenticated broad access; prefer not relying on session for media tags). Track in prep A16/A17.

### D6 — `DELETE /dnc/:e164`

- Admins can delete **their team’s** DNC entries (`createdByUserId` self/team).
- **Owner-created entries are visible (E07) but delete-protected for Admin.**
- Owner can delete any.
- Isolation test required in prep.

### D7 — `GET /org/audit-logs` team filter = **actor OR target**

Admin sees entries where **actor is on Admin’s team OR target is on Admin’s team**. Add isolation test.

### D8 — Bucket B verification

For each of the four Bucket B rows: confirm call site (file:line above); after Admin defaults drop + bypass removal, Admin 403 / Owner 200; include in staging-smoke suite. These are the endpoints most likely to expose a hidden bypass if defaults are wrong.

---

## Sequencing (honest estimate)

| Phase | Work | Estimated duration |
|-------|------|-------------------|
| **0 — Priority-zero** | `members_change_role` re-key (D1). Standalone PR. | **2–3 days** |
| **1 — Bucket A batch 1** | Highest-risk: campaign write paths, DNC delete, disposition/skip (D4) | **1 week** |
| **2 — Bucket A batch 2–N** | Remaining Bucket A, same batching discipline as Batches 1–3 | **3–5 weeks** |
| **3 — Bucket B verification** | Admin defaults drop + confirm 403s; add to smoke | **2–3 days** |
| **4 — Staging smoke automation** | `.github/workflows/rbac-staging-smoke.yml` (SF5) | **1 week** |
| **5 — Bypass-removal rehearsal** | SF4: deploy bypass-removed, full smoke, rehearse rollback | **1 week** |
| **6 — Flip prep** | Env-var rollback rehearsal (SF3), admin comms, on-call | **3 days** |
| **7 — Flip** | Staging soak ≥ 1 week, then prod flip | **1 week + 1 week soak** |

**Total: 8–12 weeks** from the date of this planning PR merge. Anything shorter is optimistic and creates pressure to skip steps at the wrong moment.

**Do not open any Batch 4 prep code PRs until this planning PR (#6) merges.**

---

## Revision history

| Date | Change |
|------|--------|
| 2026-10-21 | Initial plan (~24 remaining, optimistic 1–2 week sequence). |
| 2026-10-21 | **SF1–SF5 + D1–D8 rewrite:** exact 61-route denominator; Buckets A(20)/B(4)/C(20)/Done(17); env-var rollback (a) pending rehearsal date; bypass-removal SF4; automated smoke SF5; D1 prep-0; D2 startedBy-uniform; D3 `campaign_create`; D4 Agent dial / Admin 403; D5 token + leak note; D6 Owner DNC delete-protect; D7 actor OR target; D8 Bucket B verify; **8–12 week** sequence. |
