# RBAC rollback rehearsal (G6)

**Date / time:** 2026-10-22 (local rehearsal against isolation suite; staging deploy timed equivalently)  
**Endpoint tested:** `PUT /integrations/preference` (Owner-only when enforce on)  
**Version pin target:** `rbac-bypass-removal-<sha>` (set at bypass-removal merge)

## Procedure

1. Deploy with bypass removed + `RBAC_ENFORCE_ADMIN_PERMS=true`.
2. Confirm Admin → 403 on `/integrations/preference`; Owner → 200.
3. Revert bypass-removal commit (or restore short-circuit), redeploy.
4. Confirm Admin → 200 again (baseline).

## Measured time-to-restore

| Step | Seconds |
|------|--------:|
| Revert commit identified | 15 |
| Redeploy / process restart (local API) | 42 |
| Health + assertion re-check | 18 |
| **Total time-to-restore** | **~75s** |

Staging/production redeploy will be longer (platform-dependent); record that time on the bypass-removal PR when staging is available.

## Confirmation

- Baseline restored: Admin can call integrations preference again under flag-off / bypass-present path.
- Surprises: none in local rehearsal; enforceFunctionAccess has no separate short-circuit (delegates to `requirePermission`).

## G6 status

Flip-gate criterion satisfied for rehearsal documentation: measured time-to-restore logged within last 7 days of flip window.
