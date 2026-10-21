# RingCentral Bridge — Setup

Connects Power Dialer to the **RingCentral desktop app** on this Mac (click-to-dial via `rcapp://`), or runs a mock lifecycle for UI tests.

## Owner checklist (local)

1. Open the **RingCentral** desktop app and stay signed in.
2. From the project root: `pnpm install`
3. Copy env if needed: `cp services/ringcentral-bridge/.env.example services/ringcentral-bridge/.env`
4. In `apps/api/.env` set:
   - `DEMO_MODE=bridge`
   - `RINGCENTRAL_BRIDGE_BASE_URL=http://127.0.0.1:5997`
   - `RINGCENTRAL_BRIDGE_API_KEY` — same as bridge `BRIDGE_API_KEY`
   - `BRIDGE_CALLBACK_SECRET` — same as bridge `BRIDGE_CALLBACK_SECRET`
5. Start bridge: `pnpm dev:ringcentral-bridge`
6. Start Power Dialer: `pnpm dev:api` and `pnpm dev:web` (from apps that load `.env`)
7. Integrations → **RingCentral** → Test connection → Connected
8. Create a dial campaign with a valid number (e.g. your cell as `+1…`), Start — RingCentral should open and dial.

## Modes

| `RINGCENTRAL_BRIDGE_MODE` | Behavior |
|---------------------------|----------|
| `uri` | Opens RingCentral desktop (`rcapp://r/call?number=…`) then reports call progress after a timer |
| `mock` | Simulated calls only — no desktop app |
| `api` | Live RingOut + SMS via RingCentral JWT app (`RC_CLIENT_ID`, `RC_CLIENT_SECRET`, `RC_JWT`, `RC_DEFAULT_FROM`) |

## Note

URI mode does not receive live hang-up events from RingCentral. After `URI_CALL_HOLD_MS` (default 25s) the bridge marks the call **COMPLETED** so the dialer can move to the next contact. API mode polls RingOut status and posts real SMS delivery.
