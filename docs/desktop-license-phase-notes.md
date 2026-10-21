# Desktop + license — phase notes

Append after every phase gate. Do not start the next phase until blockers are fixed or explicitly deferred.

## Template (copy per phase)

```
### Phase N — YYYY-MM-DD

**Status:** pass | fail | pass_with_notes

**Tests run:**
- …

**Audit:**
- …

**Issues / errors:**
- (none) | …

**Follow-ups / deferred:**
- …

**Approval for next phase:** pending | approved by owner on YYYY-MM-DD
```

---

### Phase 0 — 2026-10-09

**Status:** pass

**Tests run:**
- Created phase-notes and architecture docs.
- Baseline: started local API with `DEMO_MODE=1`; `GET /health` returned `{"ok":true}`.
- Web build verified later in Phase 1 packaging.

**Audit:**
- Confirmed dialer stays out of Namecheap scope; license cloud is separate (PHP + MySQL on derivedstudio.com).
- Offline grace default documented as 7 days.

**Issues / errors:**
- (none)

**Follow-ups / deferred:**
- (none)

**Approval for next phase:** implemented under owner “complete all todos” instruction (2026-10-09)

---

### Phase 1 — 2026-10-09

**Status:** pass

**Tests run:**
- Added `apps/desktop` Electron shell (main, preload, static `/api` proxy).
- `pnpm --filter @powerdialer/web run build` succeeded.
- Electron smoke: local API listened on `127.0.0.1` only; `GET /health` → `{"ok":true}`.
- `electron-builder --mac --dir` attempted (see follow-ups if pack fails on CI/certs).

**Audit:**
- Local API forced `HOST=127.0.0.1`.
- User DB path under Electron `userData` (`dashdialer.db`).
- Dev builds default `DASHDIALER_SKIP_LICENSE=1`.

**Issues / errors:**
- First smoke failed: `NODE_ENV=production` + default secrets refused start. Fixed by desktop default `NODE_ENV=development` under DEMO_MODE.
- System shell lacked `node`/`pnpm` on PATH; used Playwright Node + standalone pnpm binary for verification.

**Follow-ups / deferred:**
- Packaged customer builds still spawn API from monorepo `tsx` paths — full offline installer needs a self-contained runtime bundle (document in README; improve when packaging for customers).
- Windows `.exe` build should be run on Windows or CI with Wine.

**Approval for next phase:** owner “complete all todos”

---

### Phase 2 — 2026-10-09

**Status:** pass_with_notes

**Tests run:**
- Added Namecheap-ready PHP under `hosting/derivedstudio-license/` (schema, admin, verify, audit table, rate limit, hashed keys).
- Local mock server (`scripts/mock-license-server.mjs`) verified: OK key, bad key, revoke → fail.

**Audit:**
- Keys hashed with pepper; plaintext only at creation in admin UI.
- Admin session + password; optional IP allowlist.
- Verify is POST JSON only; rate-limited.

**Issues / errors:**
- Live deploy to Namecheap not performed from this environment (requires your cPanel credentials). Upload + import SQL is documented in hosting README.

**Follow-ups / deferred:**
- Owner must upload `hosting/derivedstudio-license` to `public_html/license/` and configure `.env`.

**Approval for next phase:** owner “complete all todos”

---

### Phase 3 — 2026-10-09

**Status:** pass

**Tests run:**
- Desktop `license-store.cjs`: activate OK, status hasKey, bad key fails (against mock server).
- Web: `LicenseProvider`, `/license` page, banner, feature gates on campaign start/resume/import/SMS and campaign create.
- Rebuild web + `tsc --noEmit` clean.

**Audit:**
- 7-day grace encoded in `license-store.cjs`.
- Customer builds can set `DASHDIALER_SKIP_LICENSE=0` and `DASHDIALER_LICENSE_URL`.
- Browser/dev without bridge remains unlocked (`web_dev`).

**Issues / errors:**
- (none blocking)

**Follow-ups / deferred:**
- End-to-end activate against live derivedstudio.com after Phase 2 upload.

**Approval for next phase:** owner “complete all todos”

---

### Phase 4 — 2026-10-09

**Status:** pass_with_notes

**Tests run:**
- Public page `hosting/derivedstudio-site/dashdialer/index.html`.
- Ops checklist + customer help docs.

**Audit:**
- Site content is static; points to license admin and downloads; no dialer runtime.

**Issues / errors:**
- Download hrefs are placeholders until installers are copied into `downloads/`.

**Follow-ups / deferred:**
- Upload site folder to Namecheap; replace mailto if needed.

**Approval for next phase:** owner “complete all todos”

---

### Phase 5 — 2026-10-09

**Status:** pass

**Tests run:**
- Admin audit log table + UI already in Phase 2 PHP admin.
- Code signing plan documented in `docs/dashdialer-code-signing.md`.
- Auto-update explicitly deferred.

**Audit:**
- Known limitation: unsigned builds warn on Gatekeeper/SmartScreen until certificates purchased.

**Issues / errors:**
- (none)

**Follow-ups / deferred:**
- Apple Developer + Windows Authenticode when ready to ship publicly.

**Approval for next phase:** n/a — v1 plan todos complete

---

### Full audit (Phases 0–5) — 2026-10-09

**Status:** pass_with_notes (after fixes below)

**Tests run:**
- API `tsc` build clean; web `tsc --noEmit` clean; all `.cjs` syntax-checked.
- `scripts/prepare-desktop.sh` end to end: `pnpm deploy` API runtime (self-contained), Prisma client generated, empty-schema `seed.db`, Node bundled (x64).
- Deployed API started standalone from `/tmp` (no monorepo, no tsx): health OK; paid route → `402` with no state; signed state → allowed; forged signature → blocked; stale `until` → blocked.
- `license-store.cjs` against mock: bad key → inactive; good key → active; machine id stable; server 503 → grace (`offline:true`); no network → grace; tampered cache (future `lastOkAt`) → rejected; revoke → locked.
- Electron dev run with licence enforced: login through `/api` proxy OK; "License inactive" banner; activation on `/license` page → banner gone; API gate flipped to `active`; create campaign + import contacts OK; server revoke + refresh → banner "revoked by the seller", API refuses `/start` directly with 402; reads still 200; SIGTERM → engine child stopped and state file removed.
- Packaged `DashDialer.app` (x64, `--dir`) copied to `/tmp` and launched: `API mode=bundled`, licence locked by default (no dev skip), login + activation OK, clean quit.

**Audit findings → fixed:**
1. **Critical — desktop `/api` proxy was broken** (`fetch failed` on every call, so the desktop UI could never log in). Rewrote `static-server.cjs` using `http.request` streaming; also fixed path-traversal guard.
2. **Critical — packaged builds could not run** (depended on monorepo `tsx` + hardcoded Playwright Node path). Added bundled runtime (`runtime/node`, `runtime/api`, `runtime/seed.db`) via `pnpm deploy`; `main.cjs` prefers bundled, falls back to dev paths only when unpackaged; friendly error dialog otherwise.
3. **Critical — licence enforced only in the UI**; anyone could call the local API directly. Added API-side gate (`licenseGate.ts`) driven by an HMAC-signed state file written by the main process; 402 `LICENSE_REQUIRED` on create/import/start/resume/SMS.
4. **High — any non-200 from the licence server locked the app immediately** (including 5xx/429). Now only definitive 4xx answers lock; server errors and network failures use grace.
5. **High — seed DB was the developer's `dev.db`** (would ship your accounts/data to customers). Prep script now creates an empty-schema DB with `prisma db push`.
6. **High — admin panel had no CSRF protection, no login rate limit, default session cookie, logout via GET.** Added CSRF tokens on every form, 10 attempts/15 min, `HttpOnly; Secure; SameSite=Strict` cookie, 2 h idle timeout, session regeneration, login/fail audit, POST logout, optional `DD_ADMIN_PASS_HASH`.
7. **High — `DD_KEY_PEPPER` silently fell back to `insecure-default-pepper`.** Now fails closed (16+ chars required).
8. **Medium — machine id derived from hostname** (renaming PC = new seat). Now random per-install id persisted in app-data.
9. **Medium — licence cache unsigned** (edit `lastOkAt` to extend grace forever). Now HMAC-signed + future-timestamp rejection.
10. **Medium — `before-quit` did not wait for shutdown; macOS `activate` recreated window after servers were stopped; duplicate instances could start two engines on one DB.** Fixed with awaited shutdown, single-instance lock, `shuttingDown` guard, engine-crash dialog.
11. **Medium — API spawned with the full parent environment** (`DASHDIALER_SKIP_LICENSE` or odd vars could leak in) and default `AUTH_SECRET`. Now minimal env + per-install random `AUTH_SECRET`; packaged builds ignore `DASHDIALER_SKIP_LICENSE`.
12. **Low — `verify_ok` audit on every 4-hourly heartbeat** would bloat the table. Now audits only new device activations and unknown-key attempts (throttled); added `created_at` index.
13. **Low — manually set `expired` status was ignored by verify.** Handled. Admin can now also set/clear expiry, remove a single device, see devices with last-seen times.
14. **Low — `.htaccess`** now blocks `.sql/.md/.example`, disables directory listing, forces HTTPS; wildcard CORS removed from verify (not a browser API).
15. UI: banner explains *why* (revoked / expired / machine limit / offline too long); soft "Offline mode, N days left" banner during grace; a `402` from the API triggers an immediate licence refresh.

**Issues / errors during audit:**
- No `php` or Docker on this Mac → PHP changes were reviewed by hand, not executed. Must be smoke-tested on Namecheap after upload (steps in hosting README).
- Background processes started by the tooling were killed between commands; used a detached launcher for tests (not part of the repo).

**Follow-ups / deferred:**
- Live Namecheap deploy + real `verify.php` test (owner's cPanel).
- Apple Silicon DMG needs an arm64 Node for `DASHDIALER_NODE_BIN` (or build on an M-series Mac); Windows NSIS build on Windows.
- Code signing (Apple Developer ID / Authenticode) before public download.
- App icon (`apps/desktop/assets`) still default Electron icon.
- Installer size ~650 MB unpacked (Node + API deps); could be trimmed later (prune dev-only deps like bullmq/ioredis in demo-only builds).

**Approval for next phase:** pending owner review of this audit

---
