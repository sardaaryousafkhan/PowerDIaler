# DashDialer desktop + derivedstudio.com license architecture

## Responsibilities

| Piece | Where | Job |
|-------|--------|-----|
| DashDialer UI + API + SQLite | Customer PC (Electron) | Campaigns, SMS, dialing, members |
| License admin + verify | derivedstudio.com (Namecheap PHP + MySQL) | Issue / revoke keys; answer “is this key still valid?” |
| Marketing / download | derivedstudio.com | Light pages + installers; no dialer load |

## License rules (v1)

- **Billing:** Manual. Owner collects payment, then creates a key in the admin UI.
- **Activation:** App sends license key + machine id to `POST /license/api/verify.php`.
- **Heartbeat:** On launch and about every 4 hours while the app is open.
- **Offline grace:** 7 days from the last successful online `ok` response. After that, paid features lock until a successful check.
- **Machine limit:** Default 2 devices per license. Extra devices rejected until admin raises the limit or clears bindings.
- **Non-payment:** Owner sets status to `revoked` or `expired` in admin; next heartbeat locks the app.

## Feature lock (when license not OK)

Blocked: create campaign, contact import, campaign start, campaign resume, SMS send.  
Still allowed: sign-in to local app, view data, pause, notes, DNC, open renew/help link to derivedstudio.com.

The lock is enforced in **two layers**:

1. UI (buttons disabled + banner) — convenience.
2. Local API (`apps/api/src/lib/licenseGate.ts`) — the real gate. The Electron main process writes an HMAC-signed `license-state.json` (valid 6 h) after every verify; the API refuses the paid routes above with `402 LICENSE_REQUIRED` unless that file says ok. The signing secret is random per launch and shared only through the child process environment, so editing the file by hand does not unlock anything.

## Machine identity

A random 32-hex id is generated once per install and stored in app-data (`machine-id`). Renaming the computer does not consume a seat; wiping app-data does (admin can remove the stale device).

## Security notes

- License keys stored hashed (SHA-256 + server pepper) on Namecheap; the service refuses to run with a missing/placeholder pepper.
- Plaintext key shown once at creation.
- Local license cache is HMAC-signed and rejects timestamps in the future (clock tampering) — cache alone cannot grant unlimited offline use past grace.
- Server "no" answers (revoked / expired / unknown / machine_limit) lock immediately; server 5xx or no network fall back to grace.
- Local API binds to `127.0.0.1` only in desktop mode, uses a per-install random `AUTH_SECRET`, and starts from a minimal environment.
- Packaged builds **never** honour `DASHDIALER_SKIP_LICENSE`; it only works in unpackaged dev runs.
- Admin panel: CSRF tokens, secure session cookie, login rate limit + audit, 2 h idle timeout, optional IP allowlist, HTTPS forced.

## Packaged runtime layout

```
DashDialer.app/Contents/Resources/   (Windows: resources/)
  web-dist/            built React UI
  runtime/node         bundled Node binary (matches target OS/arch)
  runtime/api/         pnpm-deployed API + Prisma client
  runtime/seed.db      empty-schema SQLite copied to app-data on first run
```

## Deploy paths (Namecheap)

Suggested layout under the site document root:

```
/license/
  admin/          # password-protected admin
  api/verify.php  # public verify endpoint
  lib/            # shared PHP
  sql/schema.sql  # one-time MySQL setup
  .env.example    → copy to .env (not in web root if possible)
```

Public verify URL (example): `https://derivedstudio.com/license/api/verify.php`
