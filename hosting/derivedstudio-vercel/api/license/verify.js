import { createHash, randomBytes } from "node:crypto";

/**
 * DashDialer license verify — Vercel serverless.
 * Compatible with apps/desktop/license-store.cjs DEFAULT_VERIFY_URL path
 * (rewritten from /license/api/verify.php).
 *
 * Storage: Upstash Redis REST (Vercel KV) when KV_REST_API_URL is set.
 * Fallback: in-memory (dev only) / seed from DD_BOOTSTRAP_LICENSE_KEY.
 */

const PEPPER = process.env.DD_KEY_PEPPER || "";
const ADMIN_TOKEN = process.env.DD_ADMIN_TOKEN || "";

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("x-content-type-options", "nosniff");
  res.end(JSON.stringify(body));
}

function hashKey(plaintext) {
  return createHash("sha256").update(`${PEPPER}|${plaintext}`).digest("hex");
}

function normalizeKey(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

async function kv(method, path, body) {
  const base = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!base || !token) return null;
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) return null;
  return res.json();
}

async function getLicense(keyHash) {
  const data = await kv("GET", `/get/dd:lic:${keyHash}`);
  if (data?.result) {
    try {
      return JSON.parse(data.result);
    } catch {
      return null;
    }
  }
  // Bootstrap single key from env (first deploy / no KV yet)
  const boot = process.env.DD_BOOTSTRAP_LICENSE_KEY?.trim();
  if (boot && hashKey(normalizeKey(boot)) === keyHash) {
    return {
      keyHash,
      keyPrefix: normalizeKey(boot).slice(0, 7),
      status: "active",
      maxMachines: 2,
      expiresAt: null,
      machines: {},
      label: "bootstrap",
    };
  }
  return null;
}

async function saveLicense(lic) {
  await kv("POST", `/set/dd:lic:${lic.keyHash}`, lic);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, { ok: false, error: "POST required" });
  }
  if (!PEPPER || PEPPER.length < 16) {
    return json(res, 503, { ok: false, status: "error", error: "License service not configured" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  if (!body || typeof body !== "object") body = {};

  // Admin create: { adminToken, action:"create", label?, maxMachines? }
  if (body.action === "create") {
    if (!ADMIN_TOKEN || body.adminToken !== ADMIN_TOKEN) {
      return json(res, 401, { ok: false, error: "Unauthorized" });
    }
    const parts = [];
    for (let i = 0; i < 4; i++) parts.push(randomBytes(2).toString("hex").toUpperCase());
    const plaintext = `DD-${parts.join("-")}`;
    const keyHash = hashKey(plaintext);
    const lic = {
      keyHash,
      keyPrefix: plaintext.slice(0, 7),
      status: "active",
      maxMachines: Number(body.maxMachines) > 0 ? Number(body.maxMachines) : 2,
      expiresAt: body.expiresAt || null,
      machines: {},
      label: String(body.label || "").slice(0, 160),
    };
    await saveLicense(lic);
    return json(res, 200, { ok: true, key: plaintext, ...lic, keyHash: undefined, machines: undefined });
  }

  const key = normalizeKey(body.key);
  const machineId = String(body.machineId || "").trim();
  if (key.length < 8 || key.length > 64) {
    return json(res, 400, { ok: false, status: "inactive", error: "Invalid license key" });
  }
  if (!machineId || machineId.length > 64 || !/^[A-Za-z0-9_-]+$/.test(machineId)) {
    return json(res, 400, { ok: false, status: "inactive", error: "Invalid machine id" });
  }

  const keyHash = hashKey(key);
  const lic = await getLicense(keyHash);
  if (!lic) {
    return json(res, 404, { ok: false, status: "inactive", error: "Unknown license key" });
  }
  if (lic.status === "revoked") {
    return json(res, 403, { ok: false, status: "revoked", error: "License revoked" });
  }
  if (lic.status === "expired") {
    return json(res, 403, { ok: false, status: "expired", expiresAt: lic.expiresAt, error: "License expired" });
  }
  if (lic.expiresAt && Date.parse(lic.expiresAt) < Date.now()) {
    lic.status = "expired";
    await saveLicense(lic);
    return json(res, 403, { ok: false, status: "expired", expiresAt: lic.expiresAt, error: "License expired" });
  }

  const machines = lic.machines || {};
  if (!machines[machineId]) {
    const count = Object.keys(machines).length;
    if (count >= (lic.maxMachines || 2)) {
      return json(res, 403, {
        ok: false,
        status: "machine_limit",
        error: "Machine limit reached. Contact the seller to free a seat.",
        machines: count,
        maxMachines: lic.maxMachines || 2,
      });
    }
    machines[machineId] = { firstSeenAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() };
  } else {
    machines[machineId].lastSeenAt = new Date().toISOString();
  }
  lic.machines = machines;
  await saveLicense(lic);

  return json(res, 200, {
    ok: true,
    status: "active",
    expiresAt: lic.expiresAt,
    maxMachines: lic.maxMachines || 2,
    machines: Object.keys(machines).length,
  });
}
