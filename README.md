# DashDialer (web)

Multi-tenant SaaS dialer: companies (organizations), email/Google sign-in, role-based access, progressive dialing and SMS. Provider routing is controlled from the Integrations page.

## Companies and sign-in

- **Register company** at `/register` — creates your organization and makes you the org owner.
- **Sign in** at `/login` — email/password, or Google when `GOOGLE_OAUTH_*` is set on the API.
- **Invite employees** from Org settings — share the invite link (`/accept-invite?token=…`).
- **Agents** only see campaigns you assign them; owners/admins see all campaigns in the company.
- Architecture notes: [docs/saas-architecture.md](docs/saas-architecture.md) · deploy: [docs/deployment.md](docs/deployment.md)

## What you need

- Node.js 20+
- pnpm 9+
- Redis (for BullMQ workers outside demo mode)
- Postgres for production (`docker compose up -d postgres redis`); local demo can use SQLite
- At least one active provider path (Twilio credentials, Google Voice bridge, CallHippo bridge, or WhatsApp Cloud)

## Try the demo in your browser (no Twilio, no Redis)

If you only want to click through the product locally:

1. Install [Node.js 20+](https://nodejs.org/) and enable pnpm (`corepack enable && corepack prepare pnpm@9.15.0 --activate`).
2. From the project root:

```bash
pnpm demo
```

Or manually: copy `apps/api/.env.example` to `apps/api/.env`, set `DEMO_MODE=1`, then run `pnpm install`, `pnpm db:push`, `pnpm dev:api` (from `apps/api` so `.env` loads), and `pnpm dev:web`.

3. Open **http://127.0.0.1:5173** in your browser (in Cursor: **Simple Browser** from the Command Palette, then paste that URL).

Calls and SMS are **simulated** (contacts move to “dialed” after a short delay; SMS shows as queued/delivered without sending real messages).

## Local development

1. Install dependencies:

```bash
pnpm install
```

2. Copy environment variables for the API:

```bash
cp apps/api/.env.example apps/api/.env
```

Edit `apps/api/.env` and set at least:

- `DATABASE_URL`
- `REDIS_URL`
- `PUBLIC_BASE_URL` (must match what your webhook provider can reach)
- One provider configuration:
  - `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` for Twilio
  - `GOOGLE_VOICE_BRIDGE_BASE_URL` (and optional `GOOGLE_VOICE_BRIDGE_API_KEY`)
  - `CALLHIPPO_BRIDGE_BASE_URL` (and optional `CALLHIPPO_BRIDGE_API_KEY`)
  - `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` for WhatsApp Cloud

3. Create the database (pick one):

```bash
pnpm db:push
```

For a migration history (recommended before production), run:

```bash
pnpm db:migrate
```

4. Build shared packages:

```bash
pnpm -r --filter @powerdialer/shared --filter @powerdialer/providers run build
```

5. Run three processes (three terminals):

```bash
pnpm dev:api
```

```bash
pnpm worker
```

```bash
pnpm dev:web
```

Open the UI at `http://127.0.0.1:5173`.

## Webhooks and tunnels

Twilio and Vonage cannot reach `http://127.0.0.1`. For local testing, run a tunnel (for example [ngrok](https://ngrok.com)) pointing at your API port, then set `PUBLIC_BASE_URL` to the HTTPS tunnel base URL (no trailing slash). Twilio will POST to:

- `${PUBLIC_BASE_URL}/webhooks/twilio/voice`
- `${PUBLIC_BASE_URL}/webhooks/twilio/sms`

**Vonage** needs no dashboard webhook configuration — the app sends a per-call
`event_url` and a per-message delivery-receipt `callback` automatically (both are
protected by an unguessable token in the URL). Also set
`VONAGE_WEBHOOK_SIGNATURE_SECRET` (Dashboard → Settings → Signature secret) so signed
webhooks are cryptographically verified on top of the token check.

For Google Voice and CallHippo, this app expects your bridge service to expose:

- `POST <BRIDGE_BASE_URL>/dial` returning `{ "externalCallId": "..." }`
- `POST <BRIDGE_BASE_URL>/sms` returning `{ "externalMessageId": "..." }`

**Google Voice bridge** (local mock demo):

```bash
cp services/google-voice-bridge/.env.example services/google-voice-bridge/.env
pnpm --filter @powerdialer/google-voice-bridge run db:push
pnpm dev:google-bridge
```

Health: `http://127.0.0.1:5998/health`. See `docs/google-voice-bridge-research.md` and `services/google-voice-bridge/SETUP.md`.

When Integrations preference is set to `whatsapp`, SMS jobs are sent through Meta WhatsApp Cloud API.

## How dialing works (MVP)

- One **live** outbound call per campaign at a time (progressive dialing).
- When Twilio reports a terminal call status, the worker is triggered to dial the next **pending** contact.
- Contacts on the organization’s **DNC** list are skipped on CSV import and blocked for SMS sends.

## Compliance

This tool includes UI and API fields to record consent notes, but **legal compliance is still your responsibility** (consent, quiet hours, registry rules, etc.).

## Operational limits

- CSV imports are capped at 100MB per upload in the API.
- Campaign detail fetches up to 500 contacts for the UI list; scale the API later for very large lists.
- SMS jobs are intentionally paced using `SMS_DELAY_MS` to reduce rate-limit issues.
