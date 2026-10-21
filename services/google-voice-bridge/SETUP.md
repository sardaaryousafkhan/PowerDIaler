# Google Voice Bridge — Setup

Local HTTP bridge between Power Dialer and Google Voice / Google Contact Center telephony.

## Quick start (mock demo)

1. Copy env file:

```bash
cp services/google-voice-bridge/.env.example services/google-voice-bridge/.env
```

2. Install and push DB (from repo root):

```bash
pnpm install
pnpm --filter @powerdialer/google-voice-bridge run db:push
```

3. Start the bridge:

```bash
pnpm dev:google-bridge
```

Health check: `http://127.0.0.1:5998/health`

4. Point Power Dialer API at the bridge (`apps/api/.env`):

```
GOOGLE_VOICE_BRIDGE_BASE_URL=http://127.0.0.1:5998
GOOGLE_VOICE_BRIDGE_API_KEY=change-me-google-bridge-api-key
BRIDGE_CALLBACK_SECRET=change-me-callback-secret-min-32-chars
DEMO_USE_BRIDGE=1
```

5. In the app, choose **Google Voice** as preferred integration and run a campaign — calls/SMS are simulated in mock mode.

## Modes

| Mode | Use when |
|------|----------|
| `mock` | Local demo, automated tests (default) |
| `hybrid` | Real consumer Voice on agent desktop (`tel:` / voice.google.com) |
| `ccai` | Google Cloud Contact Center AI Platform with API credentials |

See `docs/google-voice-bridge-research.md` for API limits and production notes.

## Retest

With the bridge running:

```bash
node services/google-voice-bridge/scripts/retest.mjs
```

## Database

SQLite file: `services/google-voice-bridge/prisma/bridge.db` (via `DATABASE_URL=file:./bridge.db` in schema folder).
