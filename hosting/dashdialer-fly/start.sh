#!/bin/sh
set -e
ROOT="${HOSTED_ROOT:-/app}"
cd "$ROOT"

export DEMO_MODE="${DEMO_MODE:-1}"
export NODE_ENV="${NODE_ENV:-production}"
export PORT="${PORT:-4000}"
export GATEWAY_PORT="${GATEWAY_PORT:-8080}"
export HOST="${HOST:-127.0.0.1}"
export DATABASE_URL="${DATABASE_URL:-file:/data/dashdialer.db}"
export PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-http://127.0.0.1:4000}"
export PUBLIC_WEB_URL="${PUBLIC_WEB_URL:-http://127.0.0.1:8080}"
export AUTH_SECRET="${AUTH_SECRET:-hosted-change-me-auth-secret-32chars}"
export OWNER_EMAIL="${OWNER_EMAIL:-owner@derivedstudio.com}"
export OWNER_PASSWORD="${OWNER_PASSWORD:-OwnerChangeMe123!}"
export OWNER_NAME="${OWNER_NAME:-Derived Studio Owner}"
export CORS_ALLOWED_ORIGINS="${CORS_ALLOWED_ORIGINS:-}"

mkdir -p /data

cd "$ROOT/apps/api"
pnpm exec prisma db push --accept-data-loss
pnpm exec tsx src/server.ts &
API_PID=$!

# Wait for API health
i=0
while [ "$i" -lt 60 ]; do
  if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    break
  fi
  i=$((i + 1))
  sleep 0.5
done

cd "$ROOT"
node hosting/dashdialer-fly/gateway.mjs &
GW_PID=$!

trap 'kill $API_PID $GW_PID 2>/dev/null; exit 0' INT TERM
wait
