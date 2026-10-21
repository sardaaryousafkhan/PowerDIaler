import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { verifyApiKey } from "../auth/apiKey.js";
import { zoomAuthStatus } from "../auth/zoomOAuth.js";
import { zoomCredentialsSchema, resolveZoomCredentials } from "../auth/zoomCredentials.js";
import { env } from "../env.js";
import { checkZoomUserLicense, getUserSmsEnabled } from "../zoom/client.js";

const healthBodySchema = z.object({
  zoomCredentials: zoomCredentialsSchema.optional(),
});

async function buildHealth(credentials: ReturnType<typeof resolveZoomCredentials>) {
  const zoomAuth = await zoomAuthStatus(credentials);
  const userId =
    credentials?.defaultUserId?.trim() || env.ZOOM_DEFAULT_USER_ID?.trim() || "";
  let zoomUserPhoneLicense = false;
  let smsEnabled = false;
  if (userId) {
    zoomUserPhoneLicense = await checkZoomUserLicense(userId, credentials);
    if (env.ZOOM_BRIDGE_MODE === "api") {
      smsEnabled = await getUserSmsEnabled(userId, credentials);
    }
  } else if (env.ZOOM_BRIDGE_MODE === "mock") {
    zoomUserPhoneLicense = true;
  }

  return {
    ok: true,
    zoomAuth,
    zoomUserPhoneLicense,
    smsEnabled,
    mode: env.ZOOM_BRIDGE_MODE,
  };
}

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  /** Liveness / single-tenant fallback (platform env Zoom account). */
  app.get("/health", async () => buildHealth(resolveZoomCredentials(null)));

  /**
   * Multi-tenant health: DashDialer POSTs the org's Zoom Marketplace credentials
   * so Test connection validates that customer's account (not the shared .env).
   */
  app.post("/health", async (req, reply) => {
    if (!verifyApiKey(req)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const parsed = healthBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.message });
    }
    const credentials = resolveZoomCredentials(parsed.data.zoomCredentials ?? null);
    if (!credentials && env.ZOOM_BRIDGE_MODE === "api") {
      return reply.code(400).send({
        ok: false,
        error: "Zoom credentials required (Account ID, Client ID, Client Secret)",
      });
    }
    return buildHealth(credentials);
  });
}
