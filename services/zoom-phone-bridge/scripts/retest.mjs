#!/usr/bin/env node
// Comprehensive bridge retest. Spins up a tiny callback listener,
// hits every endpoint, and reports pass/fail for each scenario.
import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";

const BRIDGE = "http://127.0.0.1:5999";
const API_KEY = process.env.BRIDGE_API_KEY ?? "change-me-bridge-api-key";
const CALLBACK_SECRET = process.env.BRIDGE_CALLBACK_SECRET ?? "change-me-callback-secret-min-32-chars";
const ZOOM_WEBHOOK_SECRET = process.env.ZOOM_WEBHOOK_SECRET ?? "";

const PD_PORT = 4000; // POWER_DIALER_PUBLIC_URL origin must match
const callbacks = []; // { path, signature, signatureValid, body, parsed }

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const tag = ok ? "PASS" : "FAIL";
  console.log(`[${tag}] ${name}${detail ? " — " + detail : ""}`);
}

function authHeaders(extra = {}) {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${API_KEY}`,
    "x-api-key": API_KEY,
    ...extra,
  };
}

async function startCallbackListener() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const signature = req.headers["x-bridge-signature"];
        const expected = createHmac("sha256", CALLBACK_SECRET).update(raw).digest("hex");
        let valid = false;
        try {
          const a = Buffer.from(expected);
          const b = Buffer.from(String(signature ?? ""));
          valid = a.length === b.length && timingSafeEqual(a, b);
        } catch {
          valid = false;
        }
        let parsed = null;
        try {
          parsed = JSON.parse(raw);
        } catch {}
        callbacks.push({
          path: req.url,
          signature,
          signatureValid: valid,
          body: raw,
          parsed,
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"ok":true}');
      });
    });
    server.listen(PD_PORT, "127.0.0.1", () => resolve(server));
  });
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForBridge() {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${BRIDGE}/health`);
      if (r.ok) return true;
    } catch {}
    await sleep(200);
  }
  return false;
}

async function main() {
  const listener = await startCallbackListener();
  console.log(`-> Mock Power Dialer listener on http://127.0.0.1:${PD_PORT}`);

  if (!(await waitForBridge())) {
    record("bridge reachable on 5999", false, "did not respond within 6s");
    process.exit(2);
  }

  // 1. Health
  {
    const r = await fetch(`${BRIDGE}/health`);
    const j = await r.json();
    record("GET /health → 200 ok=true", r.status === 200 && j.ok === true, JSON.stringify(j));
    record("GET /health zoomAuth=ok (mock)", j.zoomAuth === "ok");
    record("GET /health mode=mock", j.mode === "mock");
  }

  // 2. Auth: missing key
  {
    const r = await fetch(`${BRIDGE}/dial`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    record("POST /dial without key → 401", r.status === 401);
  }
  // 3. Auth: wrong key
  {
    const r = await fetch(`${BRIDGE}/dial`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer wrong" },
      body: JSON.stringify({}),
    });
    record("POST /dial wrong key → 401", r.status === 401);
  }

  // 4. Validation
  {
    const r = await fetch(`${BRIDGE}/dial`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ provider: "zoom_phone" }),
    });
    record("POST /dial missing fields → 400", r.status === 400);
  }
  // 5. statusCallbackUrl host must match POWER_DIALER_PUBLIC_URL
  {
    const r = await fetch(`${BRIDGE}/dial`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        provider: "zoom_phone",
        toE164: "+12025550101",
        fromE164: "+12025550102",
        campaignId: "c1",
        contactId: "c1",
        agentZoomUserId: "agent1",
        callType: "agent",
        idempotencyKey: "call:host-rej",
        statusCallbackUrl: "http://evil.example.com/webhooks/bridge/voice",
      }),
    });
    record("POST /dial foreign callback host → 400", r.status === 400);
  }
  // 6. agent callType without agentZoomUserId
  {
    const r = await fetch(`${BRIDGE}/dial`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        provider: "zoom_phone",
        toE164: "+12025550101",
        fromE164: "+12025550102",
        campaignId: "c1",
        contactId: "c1",
        callType: "agent",
        idempotencyKey: "call:no-agent",
        statusCallbackUrl: `http://127.0.0.1:${PD_PORT}/webhooks/bridge/voice`,
      }),
    });
    record("POST /dial agent without agentZoomUserId → 400", r.status === 400);
  }
  // 7. Successful dial + idempotency replay
  let externalCallId = null;
  {
    const body = JSON.stringify({
      provider: "zoom_phone",
      toE164: "+12025550101",
      fromE164: "+12025550102",
      campaignId: "retest-camp",
      contactId: "retest-contact",
      agentZoomUserId: "agent-demo",
      callType: "agent",
      voiceMessage: "Retest",
      idempotencyKey: "call:retest-fresh",
      statusCallbackUrl: `http://127.0.0.1:${PD_PORT}/webhooks/bridge/voice`,
      correlationId: "retest-1",
    });
    const r = await fetch(`${BRIDGE}/dial`, { method: "POST", headers: authHeaders(), body });
    const j = await r.json();
    externalCallId = j.externalCallId ?? null;
    record("POST /dial success → 200 + externalCallId", r.status === 200 && !!externalCallId, j.externalCallId);

    const r2 = await fetch(`${BRIDGE}/dial`, { method: "POST", headers: authHeaders(), body });
    const j2 = await r2.json();
    record(
      "POST /dial idempotency replay → duplicate=true",
      r2.status === 200 && j2.duplicate === true && j2.externalCallId === externalCallId,
      JSON.stringify(j2),
    );
  }

  // 8. Wait for mock lifecycle callbacks (RINGING, IN_PROGRESS, COMPLETED)
  await sleep(3500);
  const voiceCbs = callbacks.filter((c) => c.path === "/webhooks/bridge/voice");
  record("voice callbacks delivered (>=3)", voiceCbs.length >= 3, `received=${voiceCbs.length}`);
  record(
    "every voice callback has valid HMAC X-Bridge-Signature",
    voiceCbs.length > 0 && voiceCbs.every((c) => c.signatureValid),
    voiceCbs.map((c) => c.signatureValid).join(","),
  );
  const completed = voiceCbs.find((c) => c.parsed?.disposition === "COMPLETED");
  record(
    "terminal COMPLETED callback received",
    !!completed && completed.parsed.externalCallId === externalCallId,
    completed ? "ok" : "missing",
  );

  // 9. Rate limit (burst 4, rate 2/s — fire 10 quickly, each with unique key)
  {
    const before = Date.now();
    const reqs = [];
    const rlStamp = Date.now();
    for (let i = 0; i < 10; i++) {
      reqs.push(
        fetch(`${BRIDGE}/dial`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            provider: "zoom_phone",
            toE164: "+12025550101",
            fromE164: "+12025550102",
            campaignId: "rl",
            contactId: `rl${i}`,
            agentZoomUserId: "agent1",
            callType: "agent",
            voiceMessage: "x",
            idempotencyKey: `call:rl-${rlStamp}-${i}`,
            statusCallbackUrl: `http://127.0.0.1:${PD_PORT}/webhooks/bridge/voice`,
          }),
        }).then((r) => r.status),
      );
    }
    const statuses = await Promise.all(reqs);
    const rl = statuses.filter((s) => s === 429).length;
    record(
      "rate limit triggers on burst (>=1 429 of 10)",
      rl >= 1,
      `status mix=${statuses.join(",")} dur=${Date.now() - before}ms`,
    );
  }

  // 9b. Idempotency must beat rate-limit: replay the FIRST call's key many times
  //     until the bucket is empty, and confirm we still get duplicate=true 200s
  //     (this is the original critical flaw — must NOT regress).
  {
    const replayKey = "call:retest-fresh";
    const reqs = Array.from({ length: 12 }, () =>
      fetch(`${BRIDGE}/dial`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          provider: "zoom_phone",
          toE164: "+12025550101",
          fromE164: "+12025550102",
          campaignId: "retest-camp",
          contactId: "retest-contact",
          agentZoomUserId: "agent-demo",
          callType: "agent",
          voiceMessage: "Retest",
          idempotencyKey: replayKey,
          statusCallbackUrl: `http://127.0.0.1:${PD_PORT}/webhooks/bridge/voice`,
        }),
      }).then(async (r) => ({ status: r.status, body: await r.json() })),
    );
    const out = await Promise.all(reqs);
    const all200 = out.every((r) => r.status === 200 && r.body.duplicate === true);
    record(
      "idempotency replay beats rate-limit (12x 200/duplicate=true)",
      all200,
      out.map((r) => r.status).join(","),
    );
  }

  // 10. SMS happy path
  {
    const r = await fetch(`${BRIDGE}/sms`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        provider: "zoom_phone",
        toE164: "+12025550101",
        fromE164: "+12025550102",
        body: "Retest SMS",
        idempotencyKey: `sms:retest-${Date.now()}`,
        statusCallbackUrl: `http://127.0.0.1:${PD_PORT}/webhooks/bridge/sms`,
      }),
    });
    const j = await r.json();
    record("POST /sms mock → externalMessageId", r.status === 200 && !!j.externalMessageId, JSON.stringify(j));
    await sleep(1000);
    const smsCbs = callbacks.filter((c) => c.path === "/webhooks/bridge/sms");
    record("SMS DELIVERED callback received", smsCbs.some((c) => c.parsed?.status === "DELIVERED"), `count=${smsCbs.length}`);
    record("SMS callbacks all signed correctly", smsCbs.length > 0 && smsCbs.every((c) => c.signatureValid));
  }

  // 11. Webhook validation handshake (mock mode lets unsigned requests through)
  {
    const payload = JSON.stringify({ event: "endpoint.url_validation", payload: { plainToken: "abc-token-xyz" } });
    const r = await fetch(`${BRIDGE}/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
    });
    let j = null;
    try {
      j = await r.json();
    } catch {}
    record(
      "POST /webhook url_validation echoes plainToken",
      r.status === 200 && j?.plainToken === "abc-token-xyz",
      JSON.stringify(j),
    );
  }

  // 12. Webhook bad JSON
  {
    const r = await fetch(`${BRIDGE}/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    record("POST /webhook malformed JSON → 400", r.status === 400);
  }

  // 13. Webhook with secret set: bad signature should be 401
  // We can't change ZOOM_WEBHOOK_SECRET at runtime, but verify behavior when secret is empty (mock allows)
  // -> handled implicitly above

  // 14. Wrong content-type to /dial
  {
    const r = await fetch(`${BRIDGE}/dial`, {
      method: "POST",
      headers: { "content-type": "text/plain", authorization: `Bearer ${API_KEY}`, "x-api-key": API_KEY },
      body: "not json",
    });
    record("POST /dial wrong content-type rejected (4xx)", r.status >= 400 && r.status < 500, `status=${r.status}`);
  }

  // 15. localhost ↔ 127.0.0.1 are treated as the same origin in allowlist
  {
    const r = await fetch(`${BRIDGE}/dial`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        provider: "zoom_phone",
        toE164: "+12025550101",
        fromE164: "+12025550102",
        campaignId: "alias",
        contactId: "alias-1",
        agentZoomUserId: "agent1",
        callType: "agent",
        voiceMessage: "x",
        idempotencyKey: `call:alias-${Date.now()}`,
        statusCallbackUrl: `http://localhost:${PD_PORT}/webhooks/bridge/voice`,
      }),
    });
    const j = await r.json().catch(() => ({}));
    record(
      "localhost callback host accepted as alias for 127.0.0.1",
      r.status === 200 && !!j.externalCallId,
      `status=${r.status}`,
    );
  }

  // 16. Admin endpoints — auth + stats + replay
  {
    const r = await fetch(`${BRIDGE}/admin/outbox/stats`);
    record("GET /admin/outbox/stats unauthenticated → 401", r.status === 401);

    const r2 = await fetch(`${BRIDGE}/admin/outbox/stats`, { headers: authHeaders() });
    const j = await r2.json();
    record(
      "GET /admin/outbox/stats authed → JSON with pending+deadLetter",
      r2.status === 200 && typeof j.pending === "number" && typeof j.deadLetter === "number",
      JSON.stringify(j),
    );

    const r3 = await fetch(`${BRIDGE}/admin/outbox/replay-all-dlq`, {
      method: "POST",
      headers: authHeaders(),
      body: "{}",
    });
    const j3 = await r3.json();
    record(
      "POST /admin/outbox/replay-all-dlq → ok",
      r3.status === 200 && j3.ok === true && typeof j3.replayed === "number",
      JSON.stringify(j3),
    );
  }

  // 17. Stop listener
  listener.close();

  const failed = results.filter((r) => !r.ok);
  console.log("\n=========================================");
  console.log(`SUMMARY: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log("FAILED:");
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? " (" + f.detail + ")" : ""}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("test harness error:", e);
  process.exit(2);
});
