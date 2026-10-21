# Google Voice / Google Phone Bridge — Research & Plan

Last updated: 2026-06-14. This document defines how Power Dialer connects to **Google Voice** (consumer / Workspace) and related Google telephony products via the HTTP bridge pattern used by Zoom Phone Bridge.

## Executive summary

| Product | Server-side outbound dial API | SMS API | Bridge approach |
|---------|------------------------------|---------|-----------------|
| **Google Voice (consumer)** | **No official public API** | **No official API** | **`mock`**: demos/tests; **`hybrid`**: `tel:` URI + Voice web UI on agent machine |
| **Google Voice for Workspace** | Limited admin APIs; not a CPaaS dial API | No programmatic SMS for standard Voice | Same as consumer for progressive dial |
| **Google CCAI Platform** (Contact Center) | **Yes** — `POST /apps/api/v1/calls` | **Yes** — `POST /apps/api/v1/sms` | **`ccai`**: Basic auth + agent email required |

Power Dialer already routes `google_voice` integration to `GOOGLE_VOICE_BRIDGE_BASE_URL`. This service implements that bridge.

---

## Architecture (mirror Zoom Phone Bridge)

```
Power Dialer API  --POST /dial,/sms-->  Google Voice Bridge  --callbacks-->  /webhooks/bridge/voice|sms
                                              |
                         mock / hybrid / ccai modes
```

Shared contract (same as other HTTP bridges):

- **Auth:** `Authorization: Bearer <BRIDGE_API_KEY>` or `X-API-Key`
- **Dial:** `POST /dial` → `{ externalCallId }`
- **SMS:** `POST /sms` → `{ externalMessageId }`
- **Callbacks:** HMAC-SHA256 body signed with `BRIDGE_CALLBACK_SECRET`, header `X-Bridge-Signature`
- **Health:** `GET /health`

Default local port: **5998** (Zoom bridge uses 5999).

---

## Mode matrix

### 1. `mock` (default)

Deterministic simulated call lifecycle (`QUEUED` → `RINGING` → `IN_PROGRESS` → `COMPLETED`) and SMS delivery callbacks. No Google credentials required. Used for local demo and CI.

### 2. `hybrid` (consumer / Workspace Voice)

Google documents no REST “place call” for standard Voice. Practical options:

- **`tel:+E164`** — OS / browser hands off to default phone app or linked device
- **`https://voice.google.com/calls?a=nc&number=...`** — opens Voice web (agent must be logged in)

Bridge behavior:

1. Accept dial request, persist call row, return `externalCallId`
2. Log / expose `hybridDialUri` in bridge logs (agent helper UI is a future Power Dialer enhancement)
3. Emit `RINGING`, then wait for timeout → `NO_ANSWER` unless manual status webhook added later

**Limitation:** No headless progressive dial on consumer Voice without violating ToS via scraping/automation.

### 3. `ccai` (Google Cloud Contact Center AI Platform)

For enterprise customers on [CCAI Platform](https://cloud.google.com/contact-center/ccai-platform/docs/apps-api):

**Base URL:** `https://{subdomain}.{domain}/apps/api/v1`

**Auth:** HTTP Basic — username = subdomain, password = API token from Settings → Developer Settings → API Credentials.

**Outbound call** ([Call endpoints](https://cloud.google.com/contact-center/ccai-platform/docs/apps-api-call)):

```http
POST /calls
Content-Type: application/json

{
  "call_type": "Voice Outbound (API)",
  "agent_email": "agent@company.com",
  "end_user_number": "+12025550101",
  "outbound_number": "+12025550102"
}
```

**Outbound SMS** ([SMS endpoints](https://cloud.google.com/contact-center/ccai-platform/docs/apps-api-sms)):

```http
POST /sms

{
  "chat_type": "Messaging (SMS)",
  "end_user_number": "+12025550101",
  "outbound_number": "+12025550102",
  "message": "Hello"
}
```

**Rate limit:** ~10 req/s per customer (documented); bridge applies its own token bucket per API key.

**Gap (v1):** CCAI call-status webhooks are not wired in this bridge yet; after successful POST the bridge emits `RINGING` then timed `COMPLETED` for progressive dial continuity. Production should subscribe to CCAI events and map to dispositions.

---

## Power Dialer field mapping

| Bridge dial body | Google meaning |
|------------------|----------------|
| `provider: "google_voice"` | Required literal |
| `agentZoomUserId` | **Agent email** for CCAI (`agent_email`); optional in mock |
| `toE164` / `fromE164` | PSTN numbers |
| `statusCallbackUrl` | Must match `POWER_DIALER_PUBLIC_URL` host |
| `idempotencyKey` | Dedup key (checked before rate limit) |

---

## Security & operations

- SQLite DB at `services/google-voice-bridge/prisma/bridge.db` (via `DATABASE_URL=file:./bridge.db`)
- Callback URL allowlist (127.0.0.1 ≡ localhost)
- Per-API-key rate limiting
- Callback outbox with DLQ + admin replay (`/admin/outbox/*`)
- Graceful SIGTERM/SIGINT shutdown
- Startup reconciliation for in-flight **mock** calls

---

## Implementation phases

| Phase | Scope | Status |
|-------|--------|--------|
| **A** | Research doc, service scaffold, mock mode, retest script | This PR |
| **B** | CCAI `ccai` mode (call + SMS POST) | Included (best-effort) |
| **C** | Hybrid URI logging + agent desktop helper in web UI | Future |
| **D** | CCAI webhook ingestion → real dispositions | Future |
| **E** | Workspace Voice admin API investigation | Future |

---

## Why not one bridge for Zoom and Google?

Separate services keep credentials, ports, and failure domains isolated. Power Dialer selects provider via integration preference and env vars (`GOOGLE_VOICE_BRIDGE_*` vs `ZOOM_PHONE_BRIDGE_*`).

---

## References

- [Google Voice](https://voice.google.com/) — no public developer dial API
- [CCAI Platform Apps API](https://cloud.google.com/contact-center/ccai-platform/docs/apps-api)
- [CCAI Call endpoints](https://cloud.google.com/contact-center/ccai-platform/docs/apps-api-call)
- [CCAI SMS endpoints](https://cloud.google.com/contact-center/ccai-platform/docs/apps-api-sms)
- Power Dialer Zoom bridge research: `docs/zoom-phone-bridge-research.md`
