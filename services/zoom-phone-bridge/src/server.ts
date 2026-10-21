import Fastify from "fastify";
import { prisma } from "./db.js";
import { env } from "./env.js";
import { adminRoutes } from "./routes/admin.js";
import { dialRoutes } from "./routes/dial.js";
import { smsRoutes } from "./routes/sms.js";
import { webhookRoutes } from "./routes/webhook.js";
import { healthRoutes } from "./routes/health.js";
import { cleanupExpiredRecords } from "./jobs/cleanup.js";
import { processCallbackOutbox } from "./zoom/callbacks.js";
import { reconcileInFlightMockCalls } from "./zoom/mockDial.js";

const app = Fastify({ logger: true });

await app.register(healthRoutes);
await app.register(dialRoutes);
await app.register(smsRoutes);
await app.register(adminRoutes);
await app.register(webhookRoutes);

const slowInterval = setInterval(() => {
  void cleanupExpiredRecords();
  void processCallbackOutbox();
}, 5 * 60 * 1000);

const fastInterval = setInterval(() => {
  void processCallbackOutbox();
}, 10_000);

// Reconcile any in-flight calls that were mid-lifecycle when the bridge last
// stopped (only matters for mock mode; api mode relies on Zoom webhooks).
if (env.ZOOM_BRIDGE_MODE === "mock") {
  const resumed = await reconcileInFlightMockCalls();
  if (resumed > 0) app.log.info({ resumed }, "resumed in-flight mock calls");
}

await app.listen({ port: env.PORT, host: "0.0.0.0" });
console.log(`Zoom Phone Bridge on http://127.0.0.1:${env.PORT} (mode=${env.ZOOM_BRIDGE_MODE})`);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "shutting down bridge");
  clearInterval(slowInterval);
  clearInterval(fastInterval);
  try {
    await app.close();
  } catch (e) {
    app.log.error({ err: e }, "fastify close failed");
  }
  try {
    await prisma.$disconnect();
  } catch (e) {
    app.log.error({ err: e }, "prisma disconnect failed");
  }
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
