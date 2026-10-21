#!/usr/bin/env node
import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";

const BRIDGE = "http://127.0.0.1:5998";
const API_KEY = process.env.BRIDGE_API_KEY ?? "change-me-google-bridge-api-key";
const CALLBACK_SECRET = process.env.BRIDGE_CALLBACK_SECRET ?? "change-me-callback-secret-min-32-chars";
const PD_PORT = 4000;
const callbacks = [];
const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? " — " + detail : ""}`);
}

function authHeaders(extra = {}) {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${API_KEY}`,
    "x-api-key": API_KEY,
    ...extra,
  };
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
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
      callbacks.push({ path: req.url, signatureValid: valid, parsed });
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    });
  });
  await new Promise((resolve) => server.listen(PD_PORT, "127.0.0.1", resolve));

  let up = false;
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${BRIDGE}/health`);
      if (r.ok) {
        up = true;
        break;
      }
    } catch {}
    await sleep(200);
  }
  if (!up) {
    record("bridge reachable on 5998", false, "start with pnpm dev:google-bridge");
    process.exit(2);
  }

  const health = await (await fetch(`${BRIDGE}/health`)).json();
  record("GET /health ok", health.ok === true);
  record("GET /health provider=google_voice", health.provider === "google_voice");
  record("GET /health mode=mock", health.mode === "mock");

  const badAuth = await fetch(`${BRIDGE}/dial`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  record("POST /dial without key → 401", badAuth.status === 401);

  const dialBody = {
    provider: "google_voice",
    toE164: "+12025550101",
    fromE164: "+12025550102",
    campaignId: "gv-camp",
    contactId: "gv-contact",
    callType: "broadcast",
    idempotencyKey: "gv:retest-1",
    statusCallbackUrl: `http://127.0.0.1:${PD_PORT}/webhooks/bridge/voice`,
  };
  const dial1 = await fetch(`${BRIDGE}/dial`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(dialBody),
  });
  const dialJson = await dial1.json();
  record("POST /dial success", dial1.status === 200 && !!dialJson.externalCallId, dialJson.externalCallId);

  const dial2 = await fetch(`${BRIDGE}/dial`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(dialBody),
  });
  const dial2Json = await dial2.json();
  record("POST /dial idempotent", dial2Json.duplicate === true);

  const smsBody = {
    provider: "google_voice",
    toE164: "+12025550101",
    fromE164: "+12025550102",
    body: "Hello from retest",
    idempotencyKey: "gv:sms-1",
    statusCallbackUrl: `http://127.0.0.1:${PD_PORT}/webhooks/bridge/sms`,
  };
  const sms1 = await fetch(`${BRIDGE}/sms`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(smsBody),
  });
  const smsJson = await sms1.json();
  record("POST /sms success", sms1.status === 200 && !!smsJson.externalMessageId);

  await sleep(4000);
  const voiceCbs = callbacks.filter((c) => c.path === "/webhooks/bridge/voice");
  record("voice callbacks >= 3", voiceCbs.length >= 3, `count=${voiceCbs.length}`);
  record("voice callbacks signed", voiceCbs.every((c) => c.signatureValid));
  record("voice provider google_voice", voiceCbs.every((c) => c.parsed?.provider === "google_voice"));

  await sleep(500);
  const smsCbs = callbacks.filter((c) => c.path === "/webhooks/bridge/sms");
  record("sms callback delivered", smsCbs.length >= 1);
  record("sms provider google_voice", smsCbs.every((c) => c.parsed?.provider === "google_voice"));

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed`);
  server.close();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
