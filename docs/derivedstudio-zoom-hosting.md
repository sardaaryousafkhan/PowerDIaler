# Hosted Zoom Phone on derivedstudio.com

Customers only paste Zoom App Marketplace Server-to-Server details in **Integrations**. The Zoom helper runs on **your** server; they never start a bridge or enter bridge URLs.

## What you run (always on)

| Process | Role |
|---------|------|
| DashDialer API | Web/API for all orgs |
| DashDialer web | UI served at your domain |
| Zoom Phone helper (`services/zoom-phone-bridge`) | Shared connector to Zoom Phone APIs |

Docker: `docker compose -f docker-compose.bridge.yml up -d` (plus your usual API/web deploy).

## Platform env (server only — not shown to customers)

In `apps/api/.env` (or host secrets):

```bash
ZOOM_PHONE_BRIDGE_BASE_URL=https://zoom-bridge.your-domain.example
ZOOM_PHONE_BRIDGE_API_KEY=<same as bridge BRIDGE_API_KEY>
BRIDGE_CALLBACK_SECRET=<long shared secret>
PUBLIC_BASE_URL=https://app.derivedstudio.com
SECRETS_MASTER_KEY=<strong random key for encrypting org secrets>
```

In `services/zoom-phone-bridge/.env`:

```bash
PORT=5999
BRIDGE_API_KEY=<same as API ZOOM_PHONE_BRIDGE_API_KEY>
BRIDGE_CALLBACK_SECRET=<same as API>
POWER_DIALER_PUBLIC_URL=https://app.derivedstudio.com
PUBLIC_BRIDGE_URL=https://zoom-bridge.your-domain.example
ZOOM_BRIDGE_MODE=api
# Optional single-tenant demo fallbacks only — production tenants use org secrets:
# ZOOM_ACCOUNT_ID=
# ZOOM_CLIENT_ID=
# ZOOM_CLIENT_SECRET=
# ZOOM_DEFAULT_USER_ID=
# ZOOM_PHONE_CALLER_ID=
```

Point HTTPS (reverse proxy / load balancer) at the helper and API. If using Zoom webhooks, subscribe to `PUBLIC_BRIDGE_URL/webhook`.

## What each customer enters

On **Integrations → Zoom Phone**:

1. Zoom Account ID  
2. Zoom Client ID  
3. Zoom Client Secret  
4. Default Zoom Phone user ID  
5. Outbound caller ID (E.164)

Then **Save credentials** and **Test connection**. Values are stored as encrypted per-organization secrets (`OrganizationSecret`). The shared helper caches Zoom OAuth tokens per credential set (Account ID + Client ID + secret), so one customer’s keys never validate another’s.

## Customer checklist (Marketplace)

1. Zoom App Marketplace → Develop → Server-to-Server OAuth app  
2. Add Phone (and User read) scopes → Activate  
3. Copy Account ID / Client ID / Client Secret  
4. Paste into DashDialer; use a Phone-licensed user ID and their direct number as caller ID  
5. SMS requires Zoom Phone SMS enabled on that user (`sms.enable`)

## Verify

- Org A and Org B can each save different Zoom credentials and both show Connected.  
- No customer sees bridge URL or bridge API key fields.
