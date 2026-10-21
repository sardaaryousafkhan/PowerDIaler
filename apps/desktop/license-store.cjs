"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");

const GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_VERIFY_URL = "https://derivedstudio.com/license/api/verify.php";
const APP_VERSION = "0.1.0";

// ---------------------------------------------------------------------------
// Machine identity: random id generated once per install + hostname salt.
// Survives hostname changes better than hardware-only hashing and does not
// collide between two identical PCs.
// ---------------------------------------------------------------------------
function machineIdPath(userData) {
  return path.join(userData, "machine-id");
}

function machineId(userData) {
  if (!userData) {
    // Fallback (should not happen in app). Deterministic but weak.
    return crypto.createHash("sha256").update(os.hostname()).digest("hex").slice(0, 32);
  }
  const p = machineIdPath(userData);
  try {
    const existing = fs.readFileSync(p, "utf8").trim();
    if (/^[a-f0-9]{32}$/.test(existing)) return existing;
  } catch {
    // create below
  }
  const fresh = crypto.randomBytes(16).toString("hex");
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(p, fresh, { encoding: "utf8", mode: 0o600 });
  return fresh;
}

// ---------------------------------------------------------------------------
// Cache: license-cache.json signed with HMAC so casual edits (e.g. bumping
// lastOkAt into the future) are detected. Not unbreakable — the server revoke
// is the real control — but it stops trivial tampering.
// ---------------------------------------------------------------------------
function storePath(userData) {
  return path.join(userData, "license-cache.json");
}

function cacheSecret(userData) {
  return crypto
    .createHash("sha256")
    .update(`dashdialer-cache|${machineId(userData)}|${os.platform()}`)
    .digest();
}

function sign(userData, data) {
  return crypto.createHmac("sha256", cacheSecret(userData)).update(JSON.stringify(data)).digest("hex");
}

function readCache(userData) {
  try {
    const p = storePath(userData);
    if (!fs.existsSync(p)) return null;
    const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!parsed || typeof parsed !== "object" || !parsed.data || !parsed.sig) return null;
    const expected = sign(userData, parsed.data);
    const a = Buffer.from(String(parsed.sig), "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const data = parsed.data;
    // Clock tamper guard: a lastOkAt in the future is invalid.
    if (data.lastOkAt && Number(data.lastOkAt) > Date.now() + 5 * 60 * 1000) return null;
    return data;
  } catch {
    return null;
  }
}

function writeCache(userData, data) {
  fs.mkdirSync(userData, { recursive: true });
  const payload = { data, sig: sign(userData, data) };
  fs.writeFileSync(storePath(userData), JSON.stringify(payload, null, 2), { encoding: "utf8", mode: 0o600 });
}

function clearCache(userData) {
  try {
    fs.unlinkSync(storePath(userData));
  } catch {
    // ignore
  }
}

function skipLicense() {
  const v = String(process.env.DASHDIALER_SKIP_LICENSE || "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function verifyUrl() {
  return process.env.DASHDIALER_LICENSE_URL || DEFAULT_VERIFY_URL;
}

function evaluateLocal(cache) {
  if (skipLicense()) {
    return { ok: true, reason: "dev_skip", status: "active", graceRemainingMs: null };
  }
  if (!cache || !cache.licenseKey) {
    return { ok: false, reason: "missing", status: "inactive", graceRemainingMs: 0 };
  }
  if (cache.lastOkAt && cache.lastRemoteOk) {
    const age = Date.now() - Number(cache.lastOkAt);
    if (age <= GRACE_MS) {
      return {
        ok: true,
        reason: age < 60_000 ? "online_ok" : "grace",
        status: cache.status || "active",
        graceRemainingMs: Math.max(0, GRACE_MS - age),
        expiresAt: cache.expiresAt || null,
      };
    }
    return { ok: false, reason: "grace_expired", status: "inactive", graceRemainingMs: 0 };
  }
  return {
    ok: false,
    reason: "inactive",
    status: cache.status || "inactive",
    graceRemainingMs: 0,
    error: cache.lastError || null,
  };
}

async function verifyRemote(userData, { licenseKey } = {}) {
  const mid = machineId(userData);

  if (skipLicense()) {
    writeCache(userData, {
      licenseKey: licenseKey || "DEV",
      machineId: mid,
      lastOkAt: Date.now(),
      lastRemoteOk: true,
      status: "active",
      expiresAt: null,
    });
    return { ok: true, status: "active", reason: "dev_skip", machineId: mid };
  }

  const cache = readCache(userData) || {};
  const key = (licenseKey || cache.licenseKey || "").trim();
  if (!key) {
    return { ok: false, status: "inactive", reason: "missing", error: "No license key", machineId: mid };
  }

  let remote;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(verifyUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ key, machineId: mid, app: "dashdialer", version: APP_VERSION }),
      signal: controller.signal,
    });
    clearTimeout(t);
    remote = await res.json().catch(() => ({}));
    if (res.status >= 500 || res.status === 429) {
      // Server trouble: behave as offline (use grace), do not downgrade cache.
      const local = evaluateLocal({ ...cache, licenseKey: key });
      return { ...local, offline: true, error: remote.error || `License server HTTP ${res.status}`, machineId: mid };
    }
    if (!res.ok && !remote.status) {
      remote = { ok: false, status: "inactive", error: remote.error || `HTTP ${res.status}` };
    }
  } catch (err) {
    // Network down: fall back to grace from last successful check.
    const local = evaluateLocal({ ...cache, licenseKey: key });
    return {
      ...local,
      offline: true,
      error: err instanceof Error ? err.message : String(err),
      machineId: mid,
    };
  }

  const ok = Boolean(remote.ok);
  const status = remote.status || (ok ? "active" : "inactive");
  writeCache(userData, {
    licenseKey: key,
    machineId: mid,
    lastOkAt: ok ? Date.now() : cache.lastOkAt || null,
    // A definitive server "no" (revoked/expired/limit/unknown) cancels grace.
    lastRemoteOk: ok,
    status,
    expiresAt: remote.expiresAt || null,
    lastError: ok ? null : remote.error || remote.message || "License inactive",
  });

  return {
    ok,
    status,
    reason: ok ? "online_ok" : status,
    expiresAt: remote.expiresAt || null,
    error: ok ? null : remote.error || remote.message || "License inactive",
    machines: remote.machines,
    maxMachines: remote.maxMachines,
    machineId: mid,
  };
}

function getLicenseStatus(userData) {
  const mid = machineId(userData);
  if (skipLicense()) {
    return {
      ok: true,
      reason: "dev_skip",
      status: "active",
      machineId: mid,
      verifyUrl: verifyUrl(),
      skipLicense: true,
    };
  }
  const cache = readCache(userData);
  const local = evaluateLocal(cache);
  return {
    ...local,
    machineId: mid,
    hasKey: Boolean(cache && cache.licenseKey),
    expiresAt: cache?.expiresAt || null,
    lastOkAt: cache?.lastOkAt || null,
    verifyUrl: verifyUrl(),
    skipLicense: false,
  };
}

module.exports = {
  GRACE_MS,
  APP_VERSION,
  machineId,
  readCache,
  writeCache,
  clearCache,
  skipLicense,
  evaluateLocal,
  verifyRemote,
  getLicenseStatus,
};
