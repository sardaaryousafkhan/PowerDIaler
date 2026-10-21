import fs from "node:fs";
import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";

/**
 * Desktop license gate (server side).
 *
 * The Electron main process verifies the license with derivedstudio.com and writes
 * a small HMAC-signed JSON state file. When DASHDIALER_LICENSE_STATE_FILE is set,
 * paid endpoints (start/resume dialing, SMS, contact import, campaign create) are
 * refused with 402 unless the file says ok and has not expired.
 *
 * Not set (plain web / server deployment) → gate is disabled.
 */

type GateState = { ok: boolean; status?: string; until: number; reason?: string };

const STATE_FILE = process.env.DASHDIALER_LICENSE_STATE_FILE?.trim() || "";
const STATE_SECRET = process.env.DASHDIALER_LICENSE_SECRET?.trim() || "";

export const LICENSE_GATE_ENABLED = Boolean(STATE_FILE);

const PAID_ROUTES: Array<{ method: string; pattern: RegExp; label: string }> = [
  { method: "POST", pattern: /^\/campaigns\/?$/, label: "create campaigns" },
  { method: "POST", pattern: /^\/campaigns\/[^/]+\/contacts\/?$/, label: "import contacts" },
  { method: "POST", pattern: /^\/campaigns\/[^/]+\/start\/?$/, label: "start dialing" },
  { method: "POST", pattern: /^\/campaigns\/[^/]+\/resume\/?$/, label: "resume dialing" },
  { method: "POST", pattern: /^\/campaigns\/[^/]+\/sms\/?$/, label: "send SMS" },
];

let cached: { mtimeMs: number; state: GateState | null } = { mtimeMs: -1, state: null };

function readState(): GateState | null {
  if (!STATE_FILE) return null;
  try {
    const st = fs.statSync(STATE_FILE);
    if (st.mtimeMs === cached.mtimeMs) return cached.state;
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as { data?: GateState; sig?: string };
    let state: GateState | null = null;
    if (raw && raw.data && typeof raw.sig === "string") {
      if (STATE_SECRET) {
        const expected = crypto.createHmac("sha256", STATE_SECRET).update(JSON.stringify(raw.data)).digest("hex");
        const a = Buffer.from(raw.sig, "hex");
        const b = Buffer.from(expected, "hex");
        if (a.length === b.length && crypto.timingSafeEqual(a, b)) state = raw.data;
      } else {
        state = raw.data;
      }
    }
    cached = { mtimeMs: st.mtimeMs, state };
    return state;
  } catch {
    cached = { mtimeMs: -1, state: null };
    return null;
  }
}

export function licenseAllowsPaid(): { ok: boolean; reason: string } {
  if (!LICENSE_GATE_ENABLED) return { ok: true, reason: "gate_disabled" };
  const s = readState();
  if (!s) return { ok: false, reason: "no_license_state" };
  if (!s.ok) return { ok: false, reason: s.reason || s.status || "inactive" };
  if (typeof s.until !== "number" || Date.now() > s.until) return { ok: false, reason: "stale" };
  return { ok: true, reason: "active" };
}

export function registerLicenseGate(app: FastifyInstance): void {
  if (!LICENSE_GATE_ENABLED) return;
  app.addHook("preHandler", async (req, reply) => {
    const path = req.url.split("?")[0] ?? "";
    const hit = PAID_ROUTES.find((r) => r.method === req.method && r.pattern.test(path));
    if (!hit) return;
    const verdict = licenseAllowsPaid();
    if (verdict.ok) return;
    reply.code(402).send({
      error: `DashDialer license is not active (${verdict.reason}). Open the License page to activate or reconnect to the internet.`,
      code: "LICENSE_REQUIRED",
      feature: hit.label,
    });
  });
  app.log.info({ stateFile: STATE_FILE }, "Desktop license gate enabled");
}
