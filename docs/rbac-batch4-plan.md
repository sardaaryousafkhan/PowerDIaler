# Batch 4 — Flag flip plan

**Status:** Plan merged (PR #6). **Prep-0 unblocked** after G1–G4 below. Do **not** flip `RBAC_ENFORCE_ADMIN_PERMS` until go/no-go is green.

**G1 measurable condition:** Bucket A is empty **AND** Bucket B is verified with expected outcomes (staging-smoke green).

---

## SF2 — Exact denominator

### Prior “~46” framing — retracted

Earlier docs said “~46 ≈ 40–46” admin-reachable endpoints. **That count was understated.** Full route registration grep found **61** HTTP endpoints in `apps/api/src/routes/`. The gap (~15) is auth/me/webhook routes plus campaign detail/write paths that were never in the C7 table of 12. **61 is the authoritative total.** Discard 46.

### Gate call-site grep (informational)

```bash
grep -rn 'requirePermission\|enforceFunctionAccess\|requireOrgAdmin\|requireOrg' apps/api/src/routes/ | grep -v test
# → 86 lines
```

**86 vs 61:** 86 counts every matching **line** (imports, comments, helper defs, flag-off branches, and call sites). Many endpoints have 1–3 matching lines (e.g. import + Batch1 path + flag-off `requireOrg`). Arithmetic: **61 endpoints × ~1.4 gate-related lines average ≈ 86.**  

**86 is informational. The flip gate denominator is 61 endpoints.** If you grep and see 86 at flip time, do not invent 25 “missing” endpoints.

### G1 denominator = HTTP route registrations

```bash
grep -rn 'app\.\(get\|post\|put\|patch\|delete\)(' apps/api/src/routes/ --include='*.ts' | grep -v test | wc -l
# → 61
```

| Bucket | Count | Role |
|--------|------:|------|
| **Done** (Batches 1–3) | **17** | Already in matrix path |
| **Bucket A** — code required | **20** | Must empty before flip |
| **Bucket B** — defaults + bypass verify | **4** | Must verify 403 after defaults drop |
| **Bucket C** — out of scope | **20** | Not admin-reachable end-user RBAC |
| **Total** | **61** | Done + A + B + C |

**61 = 17 + 20 + 4 + 20.**

---

## Go / no-go criteria

| # | Criterion | Status |
|---|-----------|--------|
| G1 | Bucket A empty **and** Bucket B verified | **NO-GO** — A=20 (prep-0 shrinks by 2) |
| G2 / **D1** | `members_change_role` re-key merged + verified (**prep-0**) | **IN PROGRESS** (this workstream) |
| G3 | Staging-smoke workflow green on `main` in last 24h (SF5) | **NO-GO** — not built |
| G4 | CI tripwire `RBAC_ENFORCE_ADMIN_PERMS=true` | **GO** |
| G5 | Env-var rollback design signed (SF3) | **Accepted (a)**; rehearsal gated by G6 |
| **G6** | **Rollback rehearsal completed and documented on `main` in the last 7 days, with measured time-to-restore** | **NO-GO** — blocks flip (not prep-0) |
| G7 | Bypass-removal PR own smoke + rollback + one-commit pin (SF4) | **NO-GO** |

**Flip is blocked unless G6 is green.** No TBD rehearsal date — the gate is the rehearsal itself.

---

## SF3 — Rollback design

**Decision: (a) Env-var confirmed** — redeploy-based rollback.  
**Sign-off:** Env-var rollback accepted; redeploy-based; **rehearsal required under G6** (documented on main within 7 days of flip, with measured time-to-restore).  
Owner: release engineer at Phase 6.  
C6 DB-backed toggle remains a post-flip improvement.

---

## SF4 / SF5

Unchanged from PR #6: bypass-removal is its own PR (one commit, one file). Staging smoke = `.github/workflows/rbac-staging-smoke.yml`; flip requires green on `main` in last 24h.

---

## Bucket A — code changes required (20)

| # | Endpoint | Current state | New key | Scope | ☐g | ☐t | ☐a |
|---|----------|---------------|---------|-------|----|----|----|
| **A0** | `PATCH /admin/access/users/:id` | `members_manage` | **`members_change_role`** | Owner-only (prep-0) | | | |
| **A0b** | `DELETE /org/members/:id` | `members_manage` | **`members_change_role` + C3 reassignment** | **prep-0b** (orphan risk — not in prep-0) | | | |
| A1 | `PUT /campaigns/:id/assignments` | `members_manage` | `members_manage` | startedBy-only (D2a) | | | |
| A2 | `GET /org/audit-logs` | `members_manage` | `audit_view` | actor OR target (D7) | | | |
| A3 | `POST /campaigns` | `campaign_create` | `campaign_create` | stamp startedByUserId | | | |
| A4 | `GET /campaigns/:id` | requireCampaignAccess | `campaign_view` | startedBy-only (D2a) | | | |
| A5 | `GET /campaigns/:id/attempts` | requireCampaignAccess | `campaign_view` | startedBy-only (D2a) | | | |
| A6 | `POST /campaigns/:id/contacts` | contact_import | `contact_import` | startedBy-only (D2a) | | | |
| A7 | `DELETE /campaigns/:id` | campaign_delete | `campaign_delete` | startedBy-only (D2a) | | | |
| A8 | `POST .../start` | campaign_start | `campaign_start` | startedBy-only (D2a) | | | |
| A9 | `POST .../pause` | campaign_pause | `campaign_pause` | startedBy-only (D2a) | | | |
| A10 | `POST .../resume` | campaign_resume | `campaign_resume` | startedBy-only (D2a) | | | |
| A11 | `POST .../sms-template` | campaign_start | **`campaign_create`** (D3) | startedBy-only (D2a) | | | |
| A12 | `POST .../agent-disposition` | campaign_start | **`campaign_dial`** (D4) | Agent assigned; Admin 403; Owner tenant | | | |
| A13 | `POST .../agent-skip` | campaign_start | **`campaign_dial`** (D4) | same as A12 | | | |
| A14 | `POST .../sms` | sms_broadcast | `sms_broadcast` | startedBy-only (D2a) | | | |
| A15 | `PATCH .../notes` | campaign_notes | `campaign_notes` | startedBy / self | | | |
| A16 | `GET .../voicemail-recording` | auth or token | token (D5a) | short-TTL; fix leak | | | |
| A17 | `GET .../voice-instructions` | auth or token | token (D5a) | same | | | |
| A18 | `DELETE /dnc/:e164` | dnc_manage | `dnc_delete` | team delete; Owner entries protected (D6) | | | |

**Priority-zero:** A0 = **Batch 4-prep-0** (PATCH only). A0b + C3 reassignment/audit = **prep-0b** (G1 cannot go green until prep-0b lands).

---

## Bucket B — (4) correctly keyed Owner-only

| Endpoint | Key | Call site | After defaults + bypass |
|----------|-----|-----------|-------------------------|
| `PATCH /org/settings` | `company_settings` | `adminAccess.ts:361` | Admin 403 / Owner 200 |
| `GET /org/billing` | `billing_view` | `adminAccess.ts:409` | Admin 403 / Owner 200 |
| `PUT /integrations/preference` | `integrations_manage` | `integrations.ts:389` | Admin 403 / Owner 200 |
| `PUT /integrations/setup/:provider` | `integrations_manage` | `integrations.ts:578` | Admin 403 / Owner 200 |

---

## Bucket C — enumerated (20) — not admin-reachable because…

| # | Endpoint | Why out of scope |
|---|----------|------------------|
| 1 | `GET /auth/me` | Session self-read; not a role/admin surface |
| 2 | `POST /auth/register-company` | Public/unauthenticated signup |
| 3 | `POST /auth/register` | Public/unauthenticated signup |
| 4 | `POST /auth/login` | Public auth; no org Admin bypass |
| 5 | `POST /auth/logout` | Session clear; self-scoped |
| 6 | `POST /auth/accept-invite` | Invite token flow; not Admin RBAC |
| 7 | `POST /auth/password-reset/request` | Public; no session Admin context |
| 8 | `POST /auth/password-reset/confirm` | Public token confirm |
| 9 | `GET /auth/google` | OAuth start; public |
| 10 | `GET /auth/google/callback` | OAuth callback; public |
| 11 | `PATCH /me/profile` | Self-scoped `/me`; not a role surface |
| 12 | `POST /me/password` | Self-scoped password change |
| 13 | `GET /me/preferences` | Self-scoped prefs |
| 14 | `PATCH /me/preferences` | Self-scoped prefs |
| 15 | `GET /me/dashboard` | Self-scoped dashboard |
| 16 | `POST /webhooks/twilio/voice` | Machine webhook; signature auth, no session |
| 17 | `POST /webhooks/twilio/sms` | Machine webhook; no session |
| 18 | `POST /webhooks/vonage/voice` | Machine webhook; no session |
| 19 | `POST /webhooks/bridge/voice` | Bridge machine auth; no session |
| 20 | `POST /webhooks/bridge/sms` | Bridge machine auth; no session |

If any row is later found to be admin-reachable with a session, it **moves to Bucket A** before flip.

---

## Done — Batches 1–3 (17)

E01–E12 + `POST /dnc` stamp + `members_invite` on invites/create-member (unchanged list from PR #6).

---

## D4 coaching visibility (G4)

**Pick: (b)** — Admin **write** of disposition/skip is 403 (Agent-only). Admin **read** of what the team logged is via existing **`GET /campaigns/:id/attempts`** (returns `callAttempt.disposition`) and campaign detail UI that uses it. Unaffected by D4’s POST denial.

**Caveat (E08 / D2a):** Admin only sees attempts for **startedBy-owned** campaigns. Owner-started campaigns assigned to Admin’s users remain invisible (accepted E08 deferral) — that is list/detail scope, not a D4 regression. Include in Admin comms: “You can still review dispositions on campaigns you started via the campaign activity/attempts view; you can no longer log dispositions on behalf of agents.”

---

## Endpoint decisions D1–D8

(D1–D3, D5–D8 unchanged from PR #6.)  
**D4** as above + G4 (b).

---

## Admin comms plan

| Field | Content |
|-------|---------|
| **Who** | Every `ORG_ADMIN` in every tenant |
| **When** | **T-14 days** initial notice; **T-48 hours** reminder |
| **What (plain language)** | **Retained:** team member list, team CRM, team DNC (own entries), campaigns you started, coaching **read** via campaign attempts on those campaigns. **Moving to Owner:** invite/create members, change roles / remove members, billing, company settings, integrations setup, company-wide DNC delete of Owner entries, logging agent dispositions. **Help:** contact Owner or support channel below. |
| **Support owner** | **[NAME / TEAM — fill before T-14]** on-call for first week post-flip |
| **Feedback loop** | Channel: **[Slack/email — fill before T-14]**. Capture flip friction. **Rollback criteria:** privilege-escalation regression, widespread Admin 403 on retained capabilities, or dialing broken for Agents → execute G6-rehearsed env-var redeploy rollback. |
| **Stub status** | Structure fixed; names/channels filled at Phase 6. **Cannot be absent at flip.** |

---

## Sequencing

| Phase | Work |
|-------|------|
| **0 — prep-0** | `members_change_role` (A0/A0b) — **now** |
| **1+** | Bucket A by risk (campaign writes, DNC delete, disposition, rest) |
| **B / smoke / bypass / flip** | As PR #6; G6 blocks flip |

Calendar estimates in prior revision are ceilings for human planning, not a throttle on execution. Gates stay measurable; work proceeds as soon as each gate is green.

**Prep-0 opens after this G1–G4 doc revision lands on main.**

---

## Revision history

| Date | Change |
|------|--------|
| 2026-10-21 | Initial plan; SF1–SF5 + D1–D8; 61-route denominator. |
| 2026-10-21 | **G1–G4 + Admin comms:** C=20 fully enumerated with reasons; prior ~46 **retracted**; 86 vs 61 arithmetic stated; **G6** rollback rehearsal gate (no TBD date); D4 coaching read = **(b)** `GET …/attempts`; Admin comms section; prep-0 unblocked. |
