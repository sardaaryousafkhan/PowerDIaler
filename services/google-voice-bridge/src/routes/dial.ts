import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { bridgeCallTypeSchema } from "@powerdialer/shared";
import { extractApiKey, verifyApiKey } from "../auth/apiKey.js";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { consumeToken, rateLimitKey } from "../lib/rateLimit.js";
import { isAllowedStatusCallbackUrl } from "../lib/validateCallbackUrl.js";
import { placeCcaiOutboundCall } from "../voice/ccaiClient.js";
import {
  hybridDialUri,
  newExternalCallId,
  startCcaiCallLifecycle,
  startHybridCallLifecycle,
  startMockCallLifecycle,
  voiceWebUri,
} from "../voice/mockDial.js";

const dialBodySchema = z.object({
  provider: z.literal("google_voice"),
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
    if (!isAllowedStatusCallbackUrl(data.statusCallbackUrl)) {
      return reply.code(400).send({ error: "statusCallbackUrl host not allowed" });
    }

    const existing = await prisma.bridgeCall.findUnique({
      where: { idempotencyKey: data.idempotencyKey },
    });
    if (existing) {
      return reply.send({ externalCallId: existing.externalCallId, duplicate: true });
    }

    if (!consumeToken(rateLimitKey("dial", extractApiKey(req)))) {
      return reply.code(429).send({ error: "Rate limit exceeded" });
    }

    const mode = env.GOOGLE_VOICE_BRIDGE_MODE;
    const agentEmail =
      data.agentZoomUserId?.trim() || env.CCAI_DEFAULT_AGENT_EMAIL?.trim() || undefined;

    if (mode === "ccai") {
      if (!agentEmail) {
        return reply.code(400).send({
          error: "agentZoomUserId (agent email) or CCAI_DEFAULT_AGENT_EMAIL required for ccai mode",
        });
      }
      let ccaiSessionId: string;
      try {
        ccaiSessionId = await placeCcaiOutboundCall({
          agentEmail,
          toE164: data.toE164,
          fromE164: data.fromE164,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return reply.code(502).send({ error: msg });
      }
      const externalCallId = newExternalCallId("gv-ccai");
      const correlationId = data.correlationId ?? randomUUID();
      const call = await prisma.bridgeCall.create({
        data: {
          idempotencyKey: data.idempotencyKey,
          externalCallId,
          campaignId: data.campaignId,
          contactId: data.contactId,
          statusCallbackUrl: data.statusCallbackUrl,
          agentEmail,
          callType: data.callType,
          correlationId,
          voicemailDropEnabled: Boolean(data.voicemailDropEnabled),
          voiceMessage: data.voiceMessage,
          voiceInstructionsUrl: data.voiceInstructionsUrl,
          voicemailAudioUrl: data.voicemailAudioUrl,
        },
      });
      void startCcaiCallLifecycle(call.id, ccaiSessionId);
      return reply.send({ externalCallId, ccaiSessionId });
    }

    if (mode === "hybrid") {
      const tel = hybridDialUri(data.toE164);
      const web = voiceWebUri(data.toE164);
      const externalCallId = newExternalCallId("gv-hybrid");
      const correlationId = data.correlationId ?? randomUUID();
      req.log.info({ tel, web, toE164: data.toE164 }, "hybrid dial URI — agent must place call manually");
      const call = await prisma.bridgeCall.create({
        data: {
          idempotencyKey: data.idempotencyKey,
          externalCallId,
          campaignId: data.campaignId,
          contactId: data.contactId,
          statusCallbackUrl: data.statusCallbackUrl,
          agentEmail,
          callType: data.callType,
          correlationId,
          voicemailDropEnabled: Boolean(data.voicemailDropEnabled),
        },
      });
      void startHybridCallLifecycle(call.id, tel);
      return reply.send({ externalCallId, hybridDialUri: tel, voiceWebUri: web });
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
        agentEmail,
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
      mode,
    });

    void startMockCallLifecycle(call.id);
    return reply.send({ externalCallId });
  });
}
