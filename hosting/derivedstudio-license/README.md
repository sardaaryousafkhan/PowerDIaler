# derivedstudio.com license service (Namecheap)

Upload this folder to your site as **`/license/`** (document root relative), for example:

`public_html/license/`

Requires PHP 8.0+ (uses `str_starts_with`, `str_contains`) and MySQL/MariaDB. Both are standard on Namecheap shared hosting.

## Setup (once)

1. In cPanel → MySQL: create a database + user; grant all on that DB.
2. Import [`sql/schema.sql`](sql/schema.sql) via phpMyAdmin.
3. Copy [`.env.example`](.env.example) to `.env` next to this README (inside `license/`). Fill in:
   - DB credentials
   - `DD_KEY_PEPPER` — **required**, 16+ random characters (use 40+). The service refuses to run with a placeholder. **Never change it later** or every issued key stops validating.
   - `DD_ADMIN_USER` and either `DD_ADMIN_PASS` (12+ chars) or `DD_ADMIN_PASS_HASH`.
   - Optional `DD_ADMIN_IP_ALLOWLIST`.
4. Make sure the site has HTTPS (Namecheap AutoSSL). `.htaccess` forces HTTPS and blocks `.env`, `lib/`, `sql/`.
5. Visit `https://derivedstudio.com/license/admin/login.php` and sign in.
6. Create a test license; verify with:

```bash
curl -s -X POST https://derivedstudio.com/license/api/verify.php \
  -H 'Content-Type: application/json' \
  -d '{"key":"DD-XXXX-XXXX-XXXX-XXXX","machineId":"testmachine1"}'
```

Expected: `{"ok":true,"status":"active",...}`. Repeating with a third different `machineId` should return `machine_limit` (default 2).

## URLs

| URL | Purpose |
|-----|---------|
| `/license/admin/` | Issue / revoke keys, manage devices, set expiry (password + CSRF-protected) |
| `/license/api/verify.php` | App activation + 4-hourly heartbeat (POST JSON only, rate-limited 60/min/IP) |

## Verify responses the app understands

| HTTP | `status` | App behaviour |
|------|----------|---------------|
| 200 | `active` | Unlocked; grace clock reset |
| 403 | `revoked` / `expired` / `machine_limit` | Locks immediately |
| 404 | `inactive` (unknown key) | Locks immediately |
| 429 / 5xx / no network | — | Treated as **offline**: keeps working up to 7 days from last OK |

## Ops after customer pays

1. Admin → Create license (label = customer name, optional expiry date).
2. Copy the key once → send to customer.
3. If they stop paying → **Revoke**. Their app locks on its next check (at most 4 hours, or immediately if they press "Refresh status").
4. If they replace a PC → remove the old device (✕ next to it) or **Clear devices**, or raise the limit.
5. Audit panel shows creations, revokes, device activations, admin logins (and failed logins), and unknown-key attempts.

## Security summary

- Keys stored as SHA-256(pepper | key); plaintext shown once at creation.
- Admin: session cookie `HttpOnly; Secure; SameSite=Strict`, 2-hour idle timeout, 10 login attempts / 15 min / IP, CSRF token on every form, optional IP allowlist.
- Verify: input length limits, machine-id format check, unknown keys audited (throttled).

This service does **not** run DashDialer campaigns. Load stays tiny.
