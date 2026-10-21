import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { extractApiKey, verifyApiKey } from "../auth/apiKey.js";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { consumeToken, rateLimitKey } from "../lib/rateLimit.js";
import { isAllowedStatusCallbackUrl } from "../lib/validateCallbackUrl.js";
import { sendCcaiSms } from "../voice/ccaiClient.js";
import { enqueueCallback } from "../voice/callbacks.js";

const smsBodySchema = z.object({
  provider: z.literal("google_voice"),
  toE164: z.string().min(8),
  fromE164: z.string().min(8),
  body: z.string().min(1),
  idempotencyKey: z.string().min(1),
  statusCallbackUrl: z.string().url().optional(),
  correlationId: z.string().optional(),
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

    if (env.GOOGLE_VOICE_BRIDGE_MODE === "ccai") {
      let messageId: string;
      try {
        messageId = await sendCcaiSms({
          toE164: data.toE164,
          fromE164: data.fromE164,
          body: data.body,
          agentEmail: env.CCAI_DEFAULT_AGENT_EMAIL,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return reply.code(502).send({ error: msg });
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
      if (data.statusCallbackUrl) {
        setTimeout(() => {
          void enqueueCallback(data.statusCallbackUrl!, {
            externalMessageId: messageId,
            status: "DELIVERED",
            provider: "google_voice",
            raw: { mode: "ccai" },
          });
        }, 800);
      }
      return reply.send({ externalMessageId: messageId });
    }

    if (env.GOOGLE_VOICE_BRIDGE_MODE === "hybrid") {
      return reply.code(501).send({
        error:
          "Consumer Google Voice has no server-side SMS API. Use ccai mode (Contact Center) or mock for testing.",
      });
    }

    const externalMessageId = `gv-mock-sms-${randomUUID()}`;
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
          provider: "google_voice",
          raw: { mode: "mock" },
        });
      }, 600);
    }

    return reply.send({ externalMessageId });
  });
}
