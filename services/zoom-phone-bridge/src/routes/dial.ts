import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { bridgeCallTypeSchema } from "@powerdialer/shared";
import { extractApiKey, verifyApiKey } from "../auth/apiKey.js";
import { prisma } from "../db.js";
import { consumeToken, rateLimitKey } from "../lib/rateLimit.js";
import { isAllowedStatusCallbackUrl } from "../lib/validateCallbackUrl.js";
import { isTerminalDisposition } from "../zoom/disposition.js";
import { newExternalCallId, startMockCallLifecycle } from "../zoom/mockDial.js";
import { env } from "../env.js";
import { zoomCredentialsSchema, resolveZoomCredentials } from "../auth/zoomCredentials.js";

const dialBodySchema = z.object({
  provider: z.literal("zoom_phone"),
  toE164: z.string().min(8),
  fromE164: z.string().min(8),
  campaignId: z.string().min(1),
  contactId: z.string().min(1),
  agentZoomUserId: z.string().optional(),
  callType: bridgeCallTypeSchema.default("agent"),
  voiceMessage: z.string().optional(),
  twimlUrl: z.string().optional(),
  voiceInstructionsUrl: z.string().optional(),
  voicemailDropEnabled: z.boolean().optional(),
  voicemailMessage: z.string().optional(),
  voicemailAudioUrl: z.string().optional(),
  voicemailAudioMimeType: z.string().optional(),
  idempotencyKey: z.string().min(1),
  statusCallbackUrl: z.string().url(),
  correlationId: z.string().optional(),
  /** Per-org Zoom Marketplace credentials from DashDialer. */
  zoomCredentials: zoomCredentialsSchema.optional(),
});

export async function dialRoutes(app: FastifyInstance): Promise<void> {
  app.post("/dial", async (req, reply) => {
    if (!verifyApiKey(req)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const body = dialBodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.message });
    }
    const data = body.data;
    const zoomCreds = resolveZoomCredentials(data.zoomCredentials ?? null);
    const agentUserId =
      data.agentZoomUserId?.trim() ||
      zoomCreds?.defaultUserId?.trim() ||
      env.ZOOM_DEFAULT_USER_ID?.trim() ||
      "";
    if (!isAllowedStatusCallbackUrl(data.statusCallbackUrl)) {
      return reply.code(400).send({ error: "statusCallbackUrl host not allowed" });
    }
    if (data.callType === "agent" && !agentUserId) {
      return reply.code(400).send({ error: "agentZoomUserId required for agent callType" });
    }

    // Idempotency check runs BEFORE rate limiting so retries of an already-accepted
    // call always return the cached externalCallId (never spuriously 429).
    const existing = await prisma.bridgeCall.findUnique({
      where: { idempotencyKey: data.idempotencyKey },
    });
    if (existing) {
      return reply.send({ externalCallId: existing.externalCallId, duplicate: true });
    }

    if (!consumeToken(rateLimitKey("dial", extractApiKey(req)))) {
      return reply.code(429).send({ error: "Rate limit exceeded" });
    }

    if (env.ZOOM_BRIDGE_MODE !== "mock") {
      return reply.code(501).send({
        error:
          "Zoom REST outbound origination is not available. Use ZOOM_BRIDGE_MODE=mock for testing or hybrid dialer — see docs/zoom-phone-bridge-research.md",
      });
    }

    const externalCallId = newExternalCallId();
    const correlationId = data.correlationId ?? randomUUID();

    const call = await prisma.bridgeCall.create({
      data: {
        idempotencyKey: data.idempotencyKey,
        externalCallId,
        campaignId: data.campaignId,
        contactId: data.contactId,
        statusCallbackUrl: data.statusCallbackUrl,
        agentZoomUserId: agentUserId || data.agentZoomUserId,
        callType: data.callType,
        correlationId,
        voicemailDropEnabled: Boolean(data.voicemailDropEnabled),
        voiceMessage: data.voiceMessage,
        voiceInstructionsUrl: data.voiceInstructionsUrl,
        voicemailAudioUrl: data.voicemailAudioUrl,
      },
    });

    req.log.info({
      campaignId: data.campaignId,
      contactId: data.contactId,
      externalCallId,
      correlationId,
      callType: data.callType,
    });

    void startMockCallLifecycle(call.id);
    return reply.send({ externalCallId });
  });
}
