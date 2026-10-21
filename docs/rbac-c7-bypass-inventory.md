# C7 — ORG_ADMIN bypass-off inventory (scoped)

**Purpose:** Before removing `isOrgAdminRole` short-circuit in `requirePermission`, every admin-reachable endpoint must have an explicit permission key (and later scope). This inventory is the Gate 2 pre-work; **no bypass removal until staging inventory is empty or intentional.**

**Flags (two, independent):**

| Flag | Controls | Env / setting |
|------|----------|----------------|
| `RBAC_ENFORCE_ADMIN_PERMS` | Bypass off — Admins must satisfy permission keys + (when v2) scope | Server env / org `permissionModelVersion` |
| `rbacNav` / `VITE_RBAC_NAV` | New role-filtered menu rail | Web feature flag |

Rollback of enforcement ≠ rollback of menu. Both must be rehearsed separately.

---

## Short-circuit sites (must all respect the flag)

| Location | Today | Post-C7 |
|----------|-------|---------|
| `orgAccess.requirePermission` L100 | `isOrgAdminRole` → allow | Only if `!enforce` (legacy) OR key true |
| `orgAccess.canAccessCampaign` | Admin → any org campaign | Team ownership / assignment |
| `orgAccess.campaignWhereForUser` | Admin → all org campaigns | Team-owned only |
| `adminAccess.requireOrgAdmin` | Owner \|\| Admin | Replace with permission + scope; do not use as sole gate |
| `resolvePermissions` | Owner/Admin ignore membership JSON overrides | Admin uses new defaults; overrides optional if we allow Owner delegates later |

---

## Endpoint inventory

Legend:

- **Gate today:** how access is checked now  
- **Target key:** matrix key after bypass off  
- **Risk:** `latent_403` = has a key but Admin default will be false → intended lockout; `missing_gate` = only `requireOrg` / `requireOrgAdmin` → **must add key before bypass off**; `ok` = key aligns with Admin keeping access; `owner_only` = intentional 403 for Admin

### adminAccess.ts

| Method | Path | Gate today | Target key | Risk |
|--------|------|------------|------------|------|
| GET | `/admin/access/users` | `requireOrgAdmin` only | `members_manage` + team scope | **missing_gate** |
| PATCH | `/admin/access/users/:id` | `members_manage` (bypass) | `members_change_role` / patch split | owner_only for role; team for agent perms |
| POST | `/org/members` | `members_manage` | `members_invite` or create | **owner_only** (invite) |
| DELETE | `/org/members/:id` | `members_manage` | Owner + demote rules | **owner_only** / demote flow |
| POST | `/org/invites` | `members_manage` | `members_invite` | **owner_only** |
| GET | `/org/invites` | `members_manage` | `members_invite` | **owner_only** |
| GET | `/org/settings` | `requireOrg` only | authenticated read OK; sensitive fields Owner | **missing_gate** (partial) |
| PATCH | `/org/settings` | `company_settings` | `company_settings` | **owner_only** / latent_403 |
| GET | `/org/billing` | `billing_view` | `billing_view` | **owner_only** / latent_403 |
| GET | `/org/audit-logs` | `members_manage` | `audit_view` + filter | change key |
| GET | `/campaigns/:id/assignments` | `requireOrgAdmin` | `members_manage` team | **missing_gate** |
| PUT | `/campaigns/:id/assignments` | `members_manage` | `members_manage` team | ok + scope |

### campaigns.ts

| Method | Path | Gate today | Target key | Risk |
|--------|------|------------|------------|------|
| POST | `/campaigns` | `campaign_create` | `campaign_create` team | ok |
| GET | `/campaigns` | `requireOrg` + where | `campaign_view` + scope where | **missing_gate** (key); where must change |
| GET | `/campaigns/:id` | `requireCampaignAccess` | `campaign_view` + scope | scope |
| DELETE | `/campaigns/:id` | `campaign_delete` | `campaign_delete` team-owned | ok + scope |
| POST | `/campaigns/:id/contacts` | `contact_import` | `contact_import` team | ok + scope |
| POST | `.../start\|pause\|resume` | start/pause/resume keys | same + **owned campaign** | ok + ownership |
| POST | `.../sms-template` | `campaign_start` | revisit → edit key | odd key |
| POST | `.../agent-disposition` | (check) | `campaign_dial` / notes | verify |
| POST | `.../agent-skip` | (check) | `campaign_dial` | verify |
| POST | `.../sms` | `sms_broadcast` | team or Owner | decide Admin SMS |
| PATCH | `.../notes` | `campaign_notes` | self/team | ok |
| GET | `.../attempts` | likely requireCampaignAccess | `campaign_view` | verify |
| GET | voicemail / voice-instructions | token or auth | keep; scope campaign | verify |

### integrations.ts

| Method | Path | Gate today | Target key | Risk |
|--------|------|------------|------------|------|
| GET | `/integrations` | `requireOrg` only | `integrations_manage` Owner; or read-only catalog for all | **missing_gate** — Admin currently sees full catalog |
| PUT | `/integrations/preference` | `integrations_manage` | Owner | **owner_only** |
| GET | `/integrations/setup/:provider` | `requireOrg` | Owner | **missing_gate** |
| GET | bridge-health | `requireOrg` | Owner or ops | **missing_gate** |
| PUT | `/integrations/setup/:provider` | `integrations_manage` | Owner | **owner_only** |

### crm.ts

| Method | Path | Gate today | Target key | Risk |
|--------|------|------------|------------|------|
| GET | `/crm/providers/.../status` | `crm_manage` | Owner (`crm_manage`) | **owner_only** for Admin |
| POST | `/crm/contacts/upsert` | `crm_manage` | `crm_view` write? → split: upsert may be system; Admin team write TBD | **re-key** |
| POST | `/crm/activities/log` | `crm_manage` | team dial path → `campaign_notes` or `crm_view` | **re-key** |
| GET | `/crm/activities` | `crm_manage` | `crm_view` team | **re-key** |

### dnc.ts

| Method | Path | Gate today | Target key | Risk |
|--------|------|------------|------------|------|
| GET | `/dnc` | `requireOrg` | `dnc_manage` view | **missing_gate** |
| POST | `/dnc` | `dnc_manage` | `dnc_manage` | ok |
| DELETE | `/dnc/:e164` | `dnc_manage` | `dnc_delete` + Owner-entry rule | change |

### me.ts / auth — out of C7 risk

Self-scoped; no Admin bypass dependency for security of other users.

### webhooks — machine auth

Not subject to org Admin bypass; leave alone.

---

## Staging “bypass-off” procedure (before prod)

1. Set `RBAC_ENFORCE_ADMIN_PERMS=1` on staging only; leave `rbacNav` off.
2. Seed: Owner, Admin A + Users, Admin B + Users, Agent.
3. Run automated suite + manual Admin A checklist: campaigns CRUD own, members list own team, billing 403, integrations write 403, Admin B user 403.
4. Fill **break log** table (path → expected 403 vs bug). Empty bugs → proceed.
5. Only then enable menu flag for internal orgs.

---

## Work the inventory implies (not yet in original Gate 2 list)

- Add `requirePermission` to every **missing_gate** row before flipping enforce flag.
- Split CRM calls off `crm_manage` onto `crm_view` where Admin should read/log.
- Replace bare `requireOrgAdmin` with permission + scope.
- `permissionModelVersion` / `RBAC_ENFORCE_ADMIN_PERMS` must be read inside `requirePermission` and scope helpers (C6 correction).

**Scoped:** Yes. **Empty inventory:** No — **~12 missing_gate / re-key items** must be closed in Gate 2 before enforce flag on prod.
