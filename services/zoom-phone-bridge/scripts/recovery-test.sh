#!/usr/bin/env bash
set -u  # do NOT use -e so the script always completes
export PATH="/Users/mmacbookpro/Desktop/PowerDIaler/.tools/node-v20.18.1-darwin-x64/bin:$PATH"
cd "$(dirname "$0")/.." || exit 1

cleanup() {
  [ -n "${B2:-}" ] && kill "$B2" 2>/dev/null
  [ -n "${B1:-}" ] && kill -9 "$B1" 2>/dev/null
  [ -n "${LISTENER:-}" ] && kill "$LISTENER" 2>/dev/null
}
trap cleanup EXIT

echo "== Step 1: launch mock PD callback listener on :4000 =="
node -e "
const http = require('http');
const fs = require('fs');
const received = [];
fs.writeFileSync('/tmp/recovery-callbacks.json', '[]');
http.createServer((req, res) => {
  let raw = '';
  req.on('data', c => raw += c);
  req.on('end', () => {
    try { received.push({ ts: Date.now(), parsed: JSON.parse(raw) }); } catch {}
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{\"ok\":true}');
    fs.writeFileSync('/tmp/recovery-callbacks.json', JSON.stringify(received, null, 2));
  });
}).listen(4000, '127.0.0.1', () => console.log('listener up on 4000'));
" >/tmp/listener.log 2>&1 &
LISTENER=$!
sleep 0.6

echo "== Step 2: fresh DB =="
rm -f prisma/bridge.db
pnpm exec prisma db push --skip-generate 2>&1 | tail -1

echo "== Step 3: boot bridge (B1) =="
node dist/server.js >/tmp/bridge-recovery.log 2>&1 &
B1=$!
sleep 1.5
echo "B1 pid=$B1"

echo "== Step 4: place call (lifecycle takes ~3s, first event in ~800ms) =="
curl -sS -X POST http://127.0.0.1:5999/dial \
  -H "Authorization: Bearer change-me-bridge-api-key" \
  -H "Content-Type: application/json" \
  -d '{"provider":"zoom_phone","toE164":"+12025550101","fromE164":"+12025550102","campaignId":"recov","contactId":"recov-1","agentZoomUserId":"agent1","callType":"agent","voiceMessage":"x","idempotencyKey":"call:recov-1","statusCallbackUrl":"http://127.0.0.1:4000/webhooks/bridge/voice"}'
echo ""

echo "== Step 5: KILL bridge immediately, before first lifecycle tick =="
sleep 0.2
kill -9 "$B1"
sleep 0.6

echo "== Step 6: DB state after kill =="
node -e "
import('./src/generated/prisma/index.js').then(async ({ PrismaClient }) => {
  const p = new PrismaClient();
  const r = await p.bridgeCall.findUnique({ where: { idempotencyKey: 'call:recov-1' } });
  console.log('disposition=' + r.disposition + ' terminalAt=' + r.terminalAt);
  await p.\$disconnect();
});
"

echo "== Step 7: callbacks delivered so far (should be 0 — killed before RINGING) =="
node -e "console.log('count=' + JSON.parse(require('fs').readFileSync('/tmp/recovery-callbacks.json','utf8')).length)"

echo "== Step 8: restart bridge (B2) — reconcile sweep should resume =="
node dist/server.js >/tmp/bridge-recovery2.log 2>&1 &
B2=$!
sleep 4

echo "== Step 9: DB state after restart + lifecycle =="
node -e "
import('./src/generated/prisma/index.js').then(async ({ PrismaClient }) => {
  const p = new PrismaClient();
  const r = await p.bridgeCall.findUnique({ where: { idempotencyKey: 'call:recov-1' } });
  console.log('disposition=' + r.disposition + ' terminalAt=' + r.terminalAt);
  await p.\$disconnect();
});
"

echo "== Step 10: callbacks delivered to PD after recovery =="
node -e "
const d = JSON.parse(require('fs').readFileSync('/tmp/recovery-callbacks.json','utf8'));
console.log('count=' + d.length);
d.forEach(c => console.log(' - ' + c.parsed.disposition));
"

echo "== Step 11: bridge log proof of reconcile =="
grep -E "resumed|listening on" /tmp/bridge-recovery2.log | head -5

cleanup
echo "done"
