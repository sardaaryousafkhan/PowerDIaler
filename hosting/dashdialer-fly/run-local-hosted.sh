#!/bin/sh
# Runs the browser dialer (API + gateway) on this Mac for temporary public access.
set -e
ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
export PATH="$ROOT/.tools/node-v20.18.1-darwin-x64/bin:$PATH"

GW_PORT="${GATEWAY_PORT:-8090}"
API_PORT="${PORT:-4000}"
LOGDIR="${TMPDIR:-/tmp}/dashdialer-hosted"
mkdir -p "$LOGDIR"

# Stop previous
for f in api.pid gw.pid tunnel.pid; do
  if [ -f "$LOGDIR/$f" ]; then
    kill "$(cat "$LOGDIR/$f")" 2>/dev/null || true
    rm -f "$LOGDIR/$f"
  fi
done
pkill -f 'hosting/dashdialer-fly/gateway.mjs' 2>/dev/null || true
pkill -f 'cloudflared tunnel --url http://127.0.0.1:'"$GW_PORT" 2>/dev/null || true

cd "$ROOT/apps/api"
export DEMO_MODE=1
export NODE_ENV=development
export PORT="$API_PORT"
export HOST=127.0.0.1
export DATABASE_URL="${DATABASE_URL:-file:./dev.db}"
export PUBLIC_BASE_URL="http://127.0.0.1:${API_PORT}"
export PUBLIC_WEB_URL="http://127.0.0.1:${GW_PORT}"
export AUTH_SECRET="${AUTH_SECRET:-hosted-demo-auth-secret-change-me-32}"
export OWNER_EMAIL="${OWNER_EMAIL:-owner@derivedstudio.com}"
export OWNER_PASSWORD="${OWNER_PASSWORD:-OwnerChangeMe123!}"
unset ZOOM_PHONE_BRIDGE_BASE_URL GOOGLE_VOICE_BRIDGE_BASE_URL RINGCENTRAL_BRIDGE_BASE_URL || true

pnpm exec prisma generate >/dev/null
pnpm exec prisma db push --accept-data-loss >/dev/null

pnpm exec tsx src/server.ts >"$LOGDIR/api.log" 2>&1 &
echo $! >"$LOGDIR/api.pid"

i=0
while [ "$i" -lt 40 ]; do
  if curl -fsS "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1; then
    break
  fi
  i=$((i + 1))
  sleep 0.25
done

cd "$ROOT"
HOSTED_ROOT="$ROOT" WEB_DIST="$ROOT/apps/web/dist" PORT="$API_PORT" GATEWAY_PORT="$GW_PORT" \
  node hosting/dashdialer-fly/gateway.mjs >"$LOGDIR/gw.log" 2>&1 &
echo $! >"$LOGDIR/gw.pid"
sleep 0.5

CF="$ROOT/.tools/cloudflared"
if [ -x "$CF" ]; then
  "$CF" tunnel --url "http://127.0.0.1:${GW_PORT}" >"$LOGDIR/tunnel.log" 2>&1 &
  echo $! >"$LOGDIR/tunnel.pid"
  i=0
  while [ "$i" -lt 30 ]; do
    url=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOGDIR/tunnel.log" 2>/dev/null | head -1 || true)
    if [ -n "$url" ]; then
      mkdir -p "$ROOT/hosting/deploy-out"
      echo "$url" >"$ROOT/hosting/deploy-out/dashdialer-web-url.txt"
      echo "LOCAL_UI=http://127.0.0.1:${GW_PORT}"
      echo "PUBLIC_UI=$url"
      exit 0
    fi
    i=$((i + 1))
    sleep 0.5
  done
fi

echo "LOCAL_UI=http://127.0.0.1:${GW_PORT}"
echo "PUBLIC_UI=(tunnel not ready — see $LOGDIR/tunnel.log)"
