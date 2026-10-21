# Zoom Phone Bridge — Setup

This service connects Power Dialer to Zoom Phone for **progressive auto-dial** and SMS (when licensed).

## Owner checklist (local demo)

1. **Install dependencies** (once): from the project root, run `pnpm install`.
2. **Bridge env**: copy `services/zoom-phone-bridge/.env.example` to `services/zoom-phone-bridge/.env` and keep `ZOOM_BRIDGE_MODE=mock` for testing without Zoom credentials.
3. **Power Dialer env**: in `apps/api/.env`, set:
   - `ZOOM_PHONE_BRIDGE_BASE_URL=http://127.0.0.1:5999`
   - `ZOOM_PHONE_BRIDGE_API_KEY` — same as bridge `BRIDGE_API_KEY`
   - `BRIDGE_CALLBACK_SECRET` — same as bridge `BRIDGE_CALLBACK_SECRET`
   - `DEMO_MODE=bridge` (optional: demo queue + real bridge callbacks)
4. **Database**: `pnpm db:push` in the API app; `pnpm --filter @powerdialer/zoom-phone-bridge exec prisma db push` for the bridge. The bridge SQLite file lives at `services/zoom-phone-bridge/prisma/bridge.db` (Prisma resolves `file:./bridge.db` relative to `prisma/schema.prisma`, not the service root).
5. **Start bridge**: `pnpm dev:bridge` — should show port **5999**.
6. **Start Power Dialer**: `pnpm demo` or `pnpm dev` + worker if not in demo mode.
7. **Integrations page**: choose **Zoom Phone**, open setup, click **Test connection** — expect “Connected”.
8. **Campaign**: create a DIAL campaign, import valid E.164 numbers (e.g. `+12025550101`), start — one call at a time; next contact dials after the bridge reports **COMPLETED**.

Without the bridge URL, Zoom Phone falls back to **manual dial** (“Call in Zoom” in the campaign screen).

---

## Zoom admin (production)

1. **Zoom Phone license** on a dedicated user (`ZOOM_DEFAULT_USER_ID`).
2. **Marketplace app** (Server-to-Server OAuth): Client ID, Client Secret, Account ID.
3. Enable **Automatically call from 3rd party apps** (`auto_call_from_third_party_apps`) for the dialer user.
4. **Webhook subscription** pointing to `PUBLIC_BRIDGE_URL/webhook` with secret `ZOOM_WEBHOOK_SECRET`.
5. Scopes: `phone:read:admin`, `phone:write:admin`, webhook events (see `docs/zoom-phone-bridge-research.md`).

## Multi-tenant hosted (derivedstudio.com)

Customers paste Marketplace credentials in DashDialer **Integrations**; they are stored per organization. The API sends those credentials on each `/dial`, `/sms`, and `POST /health` to this helper. Keep `BRIDGE_API_KEY` only on the server. See [docs/derivedstudio-zoom-hosting.md](../../docs/derivedstudio-zoom-hosting.md).

## ngrok (webhooks to your Mac)

1. `ngrok http 5999` → set `PUBLIC_BRIDGE_URL` to the HTTPS URL.
2. `ngrok http 4000` → set Power Dialer `PUBLIC_BASE_URL` to the HTTPS URL (bridge validates callback host).

## Modes

| `ZOOM_BRIDGE_MODE` | Behavior |
|--------------------|----------|
| `mock` | Simulated calls/SMS; no Zoom account required |
| `api` | Real Zoom OAuth + webhooks; outbound REST may require hybrid — see research doc |

## Docker

```bash
docker compose -f docker-compose.bridge.yml up --build
```

Copy `.env` into `services/zoom-phone-bridge/.env` before starting.

## Voicemail drop

Zoom Phone has **no answering-machine detection**. If voicemail drop is enabled on a campaign, any message plays to whoever answers; callbacks include `voicemailDropSupported: false`.
