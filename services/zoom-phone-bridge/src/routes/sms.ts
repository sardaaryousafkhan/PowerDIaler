import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { extractApiKey, verifyApiKey } from "../auth/apiKey.js";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { consumeToken, rateLimitKey } from "../lib/rateLimit.js";
import { isAllowedStatusCallbackUrl } from "../lib/validateCallbackUrl.js";
import { zoomCredentialsSchema, resolveZoomCredentials } from "../auth/zoomCredentials.js";
import { getUserSmsEnabled, sendZoomSms } from "../zoom/client.js";
import { enqueueCallback } from "../zoom/callbacks.js";

const smsBodySchema = z.object({
  provider: z.literal("zoom_phone"),
  toE164: z.string().min(8),
  fromE164: z.string().min(8),
  body: z.string().min(1),
  idempotencyKey: z.string().min(1),
  statusCallbackUrl: z.string().url().optional(),
  correlationId: z.string().optional(),
  zoomCredentials: zoomCredentialsSchema.optional(),
});

export async function smsRoutes(app: FastifyInstance): Promise<void> {
  app.post("/sms", async (req, reply) => {
    if (!verifyApiKey(req)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const parsed = smsBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.message });
    }
    const data = parsed.data;
    const zoomCreds = resolveZoomCredentials(data.zoomCredentials ?? null);
    if (data.statusCallbackUrl && !isAllowedStatusCallbackUrl(data.statusCallbackUrl)) {
      return reply.code(400).send({ error: "statusCallbackUrl host not allowed" });
    }

    const existing = await prisma.bridgeSms.findUnique({
      where: { idempotencyKey: data.idempotencyKey },
    });
    if (existing) {
      return reply.send({ externalMessageId: existing.externalMessageId, duplicate: true });
    }

    if (!consumeToken(rateLimitKey("sms", extractApiKey(req)))) {
      return reply.code(429).send({ error: "Rate limit exceeded" });
    }

    const userId =
      zoomCreds?.defaultUserId?.trim() ||
      env.ZOOM_DEFAULT_USER_ID?.trim() ||
      (env.ZOOM_BRIDGE_MODE === "mock" ? "mock-user" : "");
    if (!userId) {
      return reply.code(500).send({ error: "ZOOM_DEFAULT_USER_ID not configured" });
    }

    if (env.ZOOM_BRIDGE_MODE === "api") {
      const enabled = await getUserSmsEnabled(userId, zoomCreds);
      if (!enabled) {
        return reply.code(501).send({ error: "SMS not available on this Zoom account" });
      }
      const messageId = await sendZoomSms(userId, data.toE164, data.body, zoomCreds);
      if (!messageId) {
        return reply.code(502).send({ error: "Zoom SMS send failed" });
      }
      await prisma.bridgeSms.create({
        data: {
          idempotencyKey: data.idempotencyKey,
          externalMessageId: messageId,
          statusCallbackUrl: data.statusCallbackUrl,
          correlationId: data.correlationId,
          status: "SENT",
        },
      });
      return reply.send({ externalMessageId: messageId });
    }

    const externalMessageId = `mock-sms-${randomUUID()}`;
    await prisma.bridgeSms.create({
      data: {
        idempotencyKey: data.idempotencyKey,
        externalMessageId,
        statusCallbackUrl: data.statusCallbackUrl,
        correlationId: data.correlationId,
        status: "SENT",
      },
    });

    if (data.statusCallbackUrl) {
      setTimeout(() => {
        void enqueueCallback(data.statusCallbackUrl!, {
          externalMessageId,
          status: "DELIVERED",
          provider: "zoom_phone",
          raw: { mode: "mock" },
        });
      }, 600);
    }

    return reply.send({ externalMessageId });
  });
}
