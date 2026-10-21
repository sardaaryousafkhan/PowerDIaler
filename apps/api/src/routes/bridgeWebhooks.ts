import type { FastifyInstance } from "fastify";
import type { CallDisposition, SmsStatus } from "@prisma/client";
import { bridgeSmsCallbackSchema, bridgeVoiceCallbackSchema } from "@powerdialer/shared";
import { prisma } from "../db.js";
import { enqueueDialNext } from "../queueEnqueue.js";
import { isTerminalCallDisposition } from "../lib/dispositions.js";
import { verifyBridgeCallbackSignature } from "../lib/bridgeCallbackVerify.js";

const TERMINAL: CallDisposition[] = ["COMPLETED", "BUSY", "NO_ANSWER", "FAILED", "CANCELED"];

/**
 * IMPORTANT: this plugin MUST stay encapsulated (do NOT wrap with `fastify-plugin`).
 * It overrides the JSON content-type parser to preserve the raw body for HMAC
 * verification. De-encapsulating it would silently break JSON parsing on every
 * other API route in apps/api.
 */
export async function bridgeWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      done(null, body);
    },
  );

  app.post("/webhooks/bridge/voice", async (req, reply) => {
    const rawBody = typeof req.body === "string" ? req.body : "";
    const signature = req.headers["x-bridge-signature"] as string | undefined;
    if (!verifyBridgeCallbackSignature(rawBody, signature)) {
      return reply.code(401).send({ error: "Invalid bridge signature" });
    }

    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return reply.code(400).send({ error: "Invalid JSON" });
    }

    const parsed = bridgeVoiceCallbackSchema.safeParse(json);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.message });
    }
    const body = parsed.data;

    await prisma.webhookEvent.create({
      data: { provider: "bridge", type: "voice", rawBody },
    });

    const attempt = await prisma.callAttempt.findFirst({
      where: { externalCallId: body.externalCallId },
    });
    if (!attempt) {
      return reply.code(200).send({ ok: true });
    }

    const disposition = body.disposition as CallDisposition;
    const wasTerminal = TERMINAL.includes(attempt.disposition);
    const isRecordingOnly =
      wasTerminal && body.recordingUrl && attempt.disposition === disposition;

    if (wasTerminal && !isRecordingOnly) {
      return reply.code(200).send({ ok: true });
    }

    const rawPayload = {
      ...(typeof attempt.rawPayload === "object" && attempt.rawPayload !== null
        ? (attempt.rawPayload as Record<string, unknown>)
        : {}),
      bridge: body.raw ?? {},
      recordingUrl: body.recordingUrl,
      voicemailDropSupported: body.voicemailDropSupported,
    };

    await prisma.callAttempt.update({
      where: { id: attempt.id },
      data: { disposition, rawPayload: rawPayload as object },
    });

    if (isTerminalCallDisposition(disposition) && !wasTerminal) {
      await prisma.contact.update({
        where: { id: attempt.contactId },
        data: { status: "DIALED" },
      });
      const camp = await prisma.campaign.findUnique({
        where: { id: attempt.campaignId },
        select: { status: true, kind: true },
      });
      if (camp?.status === "RUNNING" && camp.kind !== "SMS") {
        await enqueueDialNext(attempt.campaignId);
      }
    }

    return reply.code(200).send({ ok: true });
  });

  app.post("/webhooks/bridge/sms", async (req, reply) => {
    const rawBody = typeof req.body === "string" ? req.body : "";
    const signature = req.headers["x-bridge-signature"] as string | undefined;
    if (!verifyBridgeCallbackSignature(rawBody, signature)) {
      return reply.code(401).send({ error: "Invalid bridge signature" });
    }

    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return reply.code(400).send({ error: "Invalid JSON" });
    }

    const parsed = bridgeSmsCallbackSchema.safeParse(json);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.message });
    }
    const body = parsed.data;

    await prisma.webhookEvent.create({
      data: { provider: "bridge", type: "sms", rawBody },
    });

    const smsAttempt = await prisma.smsAttempt.findFirst({
      where: { externalMessageId: body.externalMessageId },
    });
    if (!smsAttempt) {
      return reply.code(200).send({ ok: true });
    }

    const terminalSms: SmsStatus[] = ["DELIVERED", "FAILED"];
    if (terminalSms.includes(smsAttempt.status) && terminalSms.includes(body.status as SmsStatus)) {
      return reply.code(200).send({ ok: true });
    }

    await prisma.smsAttempt.update({
      where: { id: smsAttempt.id },
      data: { status: body.status as SmsStatus, rawPayload: (body.raw ?? {}) as object },
    });

    return reply.code(200).send({ ok: true });
  });
}
