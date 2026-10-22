# RBAC Flip Checklist

Fill every box before production flip. Support owner for flip week: **Derived Studio on-call** (`support@derivedstudio.com`).

## Pre-flip

- [ ] `rbac-staging-smoke.yml` green on main in last 24h
- [ ] Rollback rehearsal completed in last 7 days (G6) — see `docs/rbac-rollback-rehearsal.md`
- [ ] Staging soak ≥ 1 week with `RBAC_ENFORCE_ADMIN_PERMS=true`
- [ ] Admin comms sent (T-14, T-48) — see `docs/rbac-admin-comms.md`
- [ ] On-call named for flip window
- [ ] Rollback command documented: set `RBAC_ENFORCE_ADMIN_PERMS=false` (or unset), redeploy API
- [ ] Post-flip verification script ready (`apps/api/scripts/rbac-post-flip-verify.sh`)

## Flip (production)

Window: low-traffic weekday morning; no major releases nearby.

1. Staging flipped 1 week earlier; soak clean.
2. Set `RBAC_ENFORCE_ADMIN_PERMS=true` in prod env.
3. Redeploy API.
4. Run post-flip verification — all assertions must pass.
5. Monitor 403 rate + support channel for 4 hours.
6. If Admin 403 rate > baseline by > 20% → roll back (revert env var, redeploy).
7. Monitor 7 days; zero P1 → flip complete.

## Menus

- [ ] `rbacNav` flag on for Owner/Admin/Agent internal users (3 days)
- [ ] Then enable for all users (`VITE_RBAC_NAV=1` or remove flag gate)
