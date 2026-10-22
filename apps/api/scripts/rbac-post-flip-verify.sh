#!/usr/bin/env bash
# Post-flip verification: Owner 200 on Owner surfaces; Admin 403 on removed;
# Admin 200 on team-scoped; Agent 200 self / 403 else.
# Requires: API_BASE, OWNER_TOKEN, ADMIN_TOKEN, AGENT_TOKEN, CAMP_A, CAMP_B
set -euo pipefail
API_BASE="${API_BASE:-http://127.0.0.1:3001}"

hit() {
  local method="$1" path="$2" token="$3" expect="$4"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" \
    -H "Authorization: Bearer $token" \
    -H "content-type: application/json" \
    "${API_BASE}${path}" ${5:-})
  if [[ "$code" != "$expect" ]]; then
    echo "FAIL $method $path got $code want $expect"
    exit 1
  fi
  echo "OK $method $path → $code"
}

: "${OWNER_TOKEN:?}" "${ADMIN_TOKEN:?}" "${AGENT_TOKEN:?}"
: "${CAMP_A:?}" "${CAMP_B:?}"

hit GET /org/billing "$OWNER_TOKEN" 200
hit GET /org/billing "$ADMIN_TOKEN" 403
hit GET "/campaigns/${CAMP_A}" "$ADMIN_TOKEN" 200
hit GET "/campaigns/${CAMP_B}" "$ADMIN_TOKEN" 403
hit GET "/campaigns/${CAMP_A}" "$AGENT_TOKEN" 200
hit GET /org/billing "$AGENT_TOKEN" 403
hit PUT /integrations/preference "$ADMIN_TOKEN" 403 '-d {"preferredIntegrationKey":"twilio"}'
hit PUT /integrations/preference "$OWNER_TOKEN" 200 '-d {"preferredIntegrationKey":"twilio"}'

echo "Post-flip verification passed."
