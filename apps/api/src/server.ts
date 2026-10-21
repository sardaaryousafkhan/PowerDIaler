import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import formbody from "@fastify/formbody";
import { ZodError } from "zod";
import { env } from "./env.js";
import { prisma } from "./db.js";
import { campaignRoutes } from "./routes/campaigns.js";
import { dncRoutes } from "./routes/dnc.js";
import { integrationRoutes } from "./routes/integrations.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { bridgeWebhookRoutes } from "./routes/bridgeWebhooks.js";
import { authRoutes } from "./routes/auth.js";
import { meRoutes } from "./routes/me.js";
import { adminAccessRoutes } from "./routes/adminAccess.js";
import { crmRoutes } from "./routes/crm.js";
import { hashPassword, verifyAuthToken, type AuthClaims } from "./auth.js";
import { registerLicenseGate, licenseAllowsPaid, LICENSE_GATE_ENABLED } from "./lib/licenseGate.js";

const app = Fastify({
  logger: true,
  trustProxy: env.TRUST_PROXY,
  // Allow large CSV contact uploads (matches multipart fileSize on campaign import).
  bodyLimit: 100 * 1024 * 1024,
});

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthClaims | null;
  }
}

await app.register(cors, {
  credentials: env.CORS_ALLOW_CREDENTIALS,
  origin: (origin, cb) => {
    const configuredOrigins = env.CORS_ALLOWED_ORIGINS
      ? env.CORS_ALLOWED_ORIGINS
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean)
      : []
    // Requests without an Origin header (curl, provider webhooks) are allowed.
    if (!origin) {
      cb(null, true);
      return;
    }
    if (!configuredOrigins.length) {
      // No allowlist: open in dev/demo, closed to cross-origin browsers in production.
      cb(null, env.NODE_ENV !== "production");
      return;
    }
    cb(null, configuredOrigins.includes(origin));
  },
});
await app.register(formbody);
app.decorateRequest("auth", null);
// Must be set before routes are registered (awaited registers snapshot the handler).
app.setErrorHandler((err, req, reply) => {
  // Schemas from @powerdialer/shared use their own zod copy, so also match by shape.
  const zodLike = err as { name?: string; issues?: Array<{ message?: string }> };
  if (err instanceof ZodError || (zodLike?.name === "ZodError" && Array.isArray(zodLike.issues))) {
    const issues = (err as ZodError).issues ?? zodLike.issues ?? [];
    return reply.code(400).send({
      error: issues[0]?.message ?? "Validation failed",
      details: issues,
    });
  }
  if (typeof err === "object" && err !== null && "validation" in err) {
    const e = err as { validation?: unknown; message?: string; statusCode?: number };
    if (e.validation) {
      return reply
        .code(400)
        .send({ error: e.message ?? "Validation error", details: e.validation });
    }
  }
  const status = (err as { statusCode?: number }).statusCode;
  if (typeof status === "number" && status >= 400 && status < 500) {
    // Rate limits, bad JSON, payload too large, etc. keep their own status + message.
    return reply.code(status).send({ error: (err as Error).message || "Request error" });
  }
  req.log.error(err);
  return reply.code(500).send({ error: "Internal error" });
});
app.addHook("onSend", async (_req, reply, payload) => {
  reply.header("x-content-type-options", "nosniff");
  reply.header("x-frame-options", "DENY");
  reply.header("referrer-policy", "no-referrer");
  reply.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
  reply.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
  return payload;
});
app.addHook("preHandler", async (req) => {
  const authz = String(req.headers.authorization ?? "");
  if (!authz.toLowerCase().startsWith("bearer ")) {
    req.auth = null;
    return;
  }
  const token = authz.slice(7).trim();
  req.auth = verifyAuthToken(token);
});
registerLicenseGate(app);
await app.register(
  async (scoped) => {
    // Tight per-IP limit on login/register to slow brute-force attempts.
    await scoped.register(rateLimit, {
      max: 20,
      timeWindow: "1 minute",
      keyGenerator: (req) => req.ip,
    });
    await scoped.register(authRoutes);
  },
  { prefix: "" },
);
await app.register(webhookRoutes);
await app.register(bridgeWebhookRoutes);

await app.register(
  async (scoped) => {
    await scoped.register(rateLimit, {
      max: 200,
      timeWindow: "1 minute",
      keyGenerator: (req) => {
        const authz = String(req.headers.authorization ?? "");
        if (authz.toLowerCase().startsWith("bearer ")) {
          const claims = verifyAuthToken(authz.slice(7).trim());
          if (claims?.sub) return `user:${claims.sub}`;
        }
        return req.ip;
      },
    });
    await scoped.register(campaignRoutes);
    await scoped.register(dncRoutes);
    await scoped.register(integrationRoutes);
    await scoped.register(crmRoutes);
    await scoped.register(meRoutes);
    await scoped.register(adminAccessRoutes);
  },
  { prefix: "" },
);

async function ensureOwnerAccount(): Promise<void> {
  const email = env.OWNER_EMAIL.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    await prisma.user.create({
      data: {
        name: env.OWNER_NAME,
        email,
        passwordHash: hashPassword(env.OWNER_PASSWORD),
        role: "OWNER",
      },
    });
    app.log.info({ email }, "Master owner account created");
    return;
  }
  if (existing.role !== "OWNER") {
    await prisma.user.update({ where: { id: existing.id }, data: { role: "OWNER" } });
    app.log.info({ email }, "Existing account promoted to OWNER");
  }
  // Demo: refresh known demo owners to lighter scrypt so local sign-in stays under INP budget
  if (env.DEMO_MODE) {
    const demoEmails = new Set([email, "owner@derivedstudio.com"]);
    for (const demoEmail of demoEmails) {
      const row = await prisma.user.findUnique({ where: { email: demoEmail } });
      if (!row) continue;
      if (String(row.passwordHash ?? "").startsWith("v2:")) continue;
      const pwd =
        demoEmail === email ? env.OWNER_PASSWORD : "OwnerChangeMe123!";
      await prisma.user.update({
        where: { id: row.id },
        data: { passwordHash: hashPassword(pwd) },
      });
      app.log.info({ email: demoEmail }, "Demo password hash upgraded to v2 scrypt");
    }
  }
}

app.get("/health", async () => ({
  ok: true,
  licenseGate: LICENSE_GATE_ENABLED ? licenseAllowsPaid() : { ok: true, reason: "gate_disabled" },
}));

const listenHost = process.env.HOST?.trim() || "0.0.0.0";
await app.listen({ port: env.PORT, host: listenHost });
await ensureOwnerAccount();
try {
  const { runMultitenantBackfill } = await import("./lib/backfillMultitenant.js");
  await runMultitenantBackfill(prisma);
} catch (err) {
  console.warn("[startup] multitenant backfill skipped/failed", err);
}
if (env.DEMO_MODE) {
  console.log(`API (DEMO_MODE — no Twilio/Redis) on http://127.0.0.1:${env.PORT}`);
  // In-memory demo queue timers pause on Mac sleep / die on restart — resume RUNNING campaigns.
  const { recoverRunningCampaignQueues, startCampaignWatchdog } = await import(
    "./lib/recoverRunningCampaigns.js"
  );
  await recoverRunningCampaignQueues({ reason: "startup-recover", onlyIfStalled: false });
  startCampaignWatchdog();
} else {
  console.log(`API listening on http://0.0.0.0:${env.PORT}`);
}
