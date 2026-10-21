#!/bin/sh
set -e
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Prefer project-bundled Node/pnpm so Terminal works without a global install.
TOOLS_NODE="$ROOT/.tools/node-v20.18.1-darwin-x64/bin"
if [ -x "$TOOLS_NODE/node" ]; then
  export PATH="$TOOLS_NODE:$PATH"
fi
if ! command -v node >/dev/null 2>&1 || ! command -v pnpm >/dev/null 2>&1; then
  echo "Need Node.js + pnpm. Expected portable Node at:"
  echo "  $TOOLS_NODE"
  echo "Download: https://nodejs.org/dist/v20.18.1/node-v20.18.1-darwin-x64.tar.gz"
  exit 1
fi
if ! command -v pnpm >/dev/null 2>&1; then
  corepack enable 2>/dev/null || true
  corepack prepare pnpm@9.15.0 --activate 2>/dev/null || true
fi

# Load apps/api/.env first. DEMO_MODE=bridge sends real Zoom Phone SMS/calls via the local bridge.
# DEMO_MODE=1 (or unset) fakes SMS locally — nothing appears in Zoom Phone.
if [ -f "$ROOT/apps/api/.env" ]; then
  set -a
  # shellcheck disable=SC1090
  # Load KEY=VALUE lines only (skip blanks/comments) so unquoted spaces cannot break the shell.
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|\#*) continue ;;
    esac
    key="${line%%=*}"
    val="${line#*=}"
    # Strip surrounding quotes if present
    case "$val" in
      \"*\") val="${val#\"}"; val="${val%\"}" ;;
      \'*\') val="${val#\'}"; val="${val%\'}" ;;
    esac
    # Export only simple KEY names
    case "$key" in
      *[!A-Za-z0-9_]*|'') continue ;;
    esac
    export "$key=$val"
  done < "$ROOT/apps/api/.env"
  set +a
fi
# Default to fake demo only when .env did not set DEMO_MODE.
if [ -z "${DEMO_MODE:-}" ]; then
  export DEMO_MODE=1
fi

cd "$ROOT"
pnpm install
pnpm -r --filter @powerdialer/shared --filter @powerdialer/providers run build

cd "$ROOT/apps/api"
pnpm exec prisma generate
pnpm exec prisma db push --accept-data-loss

BRIDGE_PID=""
# Real Zoom SMS/calls need the local Zoom Phone bridge (port 5999).
# Fake demo mode (DEMO_MODE=1) skips it on purpose.
case "${DEMO_MODE}" in
  bridge|BRIDGE)
    BRIDGE_DIR="$ROOT/services/zoom-phone-bridge"
    if [ -d "$BRIDGE_DIR" ]; then
      echo "Starting Zoom Phone bridge (DEMO_MODE=bridge)…"
      (
        cd "$BRIDGE_DIR"
        if [ -f .env ]; then
          set -a
          # shellcheck disable=SC1091
          . ./.env
          set +a
        fi
        pnpm exec prisma generate >/dev/null 2>&1 || true
        pnpm exec tsx src/server.ts
      ) &
      BRIDGE_PID=$!
      # Wait until health answers (or give up after ~15s)
      i=0
      while [ "$i" -lt 30 ]; do
        if curl -sf http://127.0.0.1:5999/health >/dev/null 2>&1; then
          echo "  Bridge: http://127.0.0.1:5999/health"
          break
        fi
        i=$((i + 1))
        sleep 0.5
      done
      if ! curl -sf http://127.0.0.1:5999/health >/dev/null 2>&1; then
        echo "WARNING: Zoom bridge did not become healthy. SMS/calls will not reach Zoom Phone."
      fi
    else
      echo "WARNING: services/zoom-phone-bridge missing — cannot start bridge."
    fi
    ;;
  *)
    echo "DEMO_MODE=${DEMO_MODE} — Zoom bridge not started (SMS/calls are simulated)."
    ;;
esac

cd "$ROOT/apps/api"
pnpm exec tsx src/server.ts &
API_PID=$!
sleep 2
cd "$ROOT/apps/web"
pnpm exec vite --host 127.0.0.1 --port 5173 &
WEB_PID=$!

echo ""
echo "Demo is running:"
echo "  UI:  http://127.0.0.1:5173"
echo "  API: http://127.0.0.1:4000/health"
if [ -n "$BRIDGE_PID" ]; then
  echo "  Zoom bridge: http://127.0.0.1:5999/health"
fi
echo ""
echo "In Cursor: Command Palette → 'Simple Browser: Show' → paste the UI URL."
echo "Press Ctrl+C to stop."

trap 'kill $API_PID $WEB_PID $BRIDGE_PID 2>/dev/null; exit 0' INT TERM
wait
