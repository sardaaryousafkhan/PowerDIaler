# DashDialer desktop

Electron shell that runs the local API + built web UI on `127.0.0.1` only. Customer data lives under the OS app-data folder. The installer is **self-contained**: it ships its own Node runtime and a deployed copy of the API, so customers never need Node, pnpm, or the source code.

## Prerequisites (build machine)

- Node 20+ and pnpm
- From repo root: `pnpm install`

## Dev (this Mac)

```bash
pnpm desktop:dev
# = build web UI, then `electron .` from apps/desktop
```

In unpackaged dev runs the license check is skipped unless you set `DASHDIALER_SKIP_LICENSE=0`. To test real licensing locally:

```bash
# terminal 1
node scripts/mock-license-server.mjs            # valid key: DD-TEST-TEST-TEST-TEST
# terminal 2
export DASHDIALER_SKIP_LICENSE=0
export DASHDIALER_LICENSE_URL=http://127.0.0.1:8787/license/api/verify.php
pnpm --filter @powerdialer/desktop run dev
```

Mock admin helpers: `POST /admin/revoke {"key":...}` and `POST /admin/outage {"on":true}` (simulates server down → app should keep working on grace).

## Package installers

```bash
pnpm desktop:dist:mac   # runs scripts/prepare-desktop.sh, then electron-builder --mac (dmg x64 + arm64)
pnpm desktop:dist:win   # same, for Windows NSIS (run on Windows, or Mac with Wine)
```

`scripts/prepare-desktop.sh` builds everything and assembles `apps/desktop/runtime/`:

| Path | What |
|------|------|
| `runtime/api/` | API deployed with `pnpm deploy --prod` + generated Prisma client (no sources) |
| `runtime/node` (`node.exe` on Windows) | Node binary bundled for the customer |
| `runtime/seed.db` | **Empty-schema** SQLite created with `prisma db push` (never your dev data) |

Important: the bundled Node and Prisma engines must match the **target** OS/CPU. Building an Apple Silicon DMG on an Intel Mac (or vice versa) requires `DASHDIALER_NODE_BIN=/path/to/node-for-that-arch` and running prep per architecture. Easiest: build each installer on a machine of that type.

Outputs land in `apps/desktop/release/`. `runtime/` and `release/` are git-ignored.

## How the app starts

1. Main process picks a free `127.0.0.1` port, copies `seed.db` → `dashdialer.db` on first run, generates a per-install `AUTH_SECRET` (`local-secrets.json`).
2. Spawns `runtime/node runtime/api/dist/server.js` with a minimal environment (`DEMO_MODE=1` by default) and waits for `/health`.
3. Serves `web-dist` on a second local port with an `/api` reverse proxy; opens the window at `/login`.
4. Verifies the license with derivedstudio.com, writes a signed `license-state.json` that the **API** reads before allowing paid routes (create campaign, import, start, resume, SMS). Re-checks every 4 hours.
5. On quit, stops the engine and removes the state file.

Customer provider settings (Twilio/RingCentral keys, `DEMO_MODE=0`) can be placed in `engine.env` inside the app-data folder; they are loaded on next launch.

## Data paths

| OS | App data |
|----|----------|
| macOS | `~/Library/Application Support/DashDialer/` |
| Windows | `%APPDATA%/DashDialer/` |

Contains `dashdialer.db` (SQLite), `license-cache.json` (signed), `machine-id`, `local-secrets.json`, and while running `license-state.json`.
