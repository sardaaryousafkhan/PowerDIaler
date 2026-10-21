#!/usr/bin/env node
/**
 * Local stand-in for derivedstudio.com/license/api/verify.php
 * Usage: node scripts/mock-license-server.mjs
 * Env: MOCK_LICENSE_PORT=8787 MOCK_VALID_KEY=DD-TEST-TEST-TEST-TEST
 */
import http from "node:http";
import crypto from "node:crypto";

const port = Number(process.env.MOCK_LICENSE_PORT || 8787);
const validKey = process.env.MOCK_VALID_KEY || "DD-TEST-TEST-TEST-TEST";
const revoked = new Set();
const machines = new Map(); // key -> Set(machineId)
const maxMachines = 2;
let outage = false;

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === "/admin/revoke" && req.method === "POST") {
    const body = await readJson(req);
    revoked.add(String(body.key || ""));
    json(res, 200, { ok: true });
    return;
  }
  if (req.url === "/admin/outage" && req.method === "POST") {
    const body = await readJson(req);
    outage = Boolean(body.on);
    json(res, 200, { ok: true, outage });
    return;
  }

  if (req.url !== "/license/api/verify.php" || req.method !== "POST") {
    json(res, 404, { ok: false, error: "Not found" });
    return;
  }
  if (outage) {
    json(res, 503, { ok: false, status: "error", error: "License service unavailable" });
    return;
  }

  const body = await readJson(req);
  const key = String(body.key || "").trim();
  const machineId = String(body.machineId || "").trim();

  if (!key || !machineId) {
    json(res, 400, { ok: false, status: "inactive", error: "Invalid input" });
    return;
  }
  if (revoked.has(key)) {
    json(res, 403, { ok: false, status: "revoked", error: "License revoked" });
    return;
  }
  if (key !== validKey) {
    json(res, 404, { ok: false, status: "inactive", error: "Unknown license key" });
    return;
  }

  let set = machines.get(key);
  if (!set) {
    set = new Set();
    machines.set(key, set);
  }
  if (!set.has(machineId) && set.size >= maxMachines) {
    json(res, 403, {
      ok: false,
      status: "machine_limit",
      error: "Machine limit reached",
      machines: set.size,
      maxMachines,
    });
    return;
  }
  set.add(machineId);
  json(res, 200, {
    ok: true,
    status: "active",
    expiresAt: null,
    machines: set.size,
    maxMachines,
    graceHintDays: 7,
    mock: true,
    requestId: crypto.randomBytes(4).toString("hex"),
  });
});

function readJson(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

server.listen(port, "127.0.0.1", () => {
  console.log(`Mock license server http://127.0.0.1:${port}/license/api/verify.php`);
  console.log(`Valid key: ${validKey}`);
});
