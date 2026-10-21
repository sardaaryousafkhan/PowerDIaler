import type { FastifyInstance, FastifyRequest } from "fastify";
import { dropVonageVoicemail } from "@powerdialer/providers";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { getTwilioWebhookProviders, getVonageWebhookProviders } from "../providers.js";
import { enqueueDialNext } from "../queueEnqueue.js";
import { isTerminalCallDisposition } from "../lib/dispositions.js";
import {
  campaignMediaToken,
  verifyCampaignMediaToken,
  verifyWebhookQueryToken,
} from "../lib/webhookToken.js";
import type { CallDisposition, SmsStatus } from "@prisma/client";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function sayTwiml(message: string): string {
  const safe = escapeXml(message.slice(0, 500));
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna">${safe}</Say></Response>`;
}

function publicRequestUrl(req: FastifyRequest): string {
  const base = (env.PUBLIC_WEBHOOK_BASE_URL ?? env.PUBLIC_BASE_URL).replace(/\/$/, "");
  return `${base}${req.url}`;
}

function mapSmsStatus(s: import("@powerdialer/shared").SmsStatus): SmsStatus {
  return s as SmsStatus;
}

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  app.all("/webhooks/twilio/voice/twiml", async (req, reply) => {
    const query = req.query as { campaignId?: string; contactId?: string; t?: string };
    if (!query.campaignId) {
      reply.type("text/xml");
      return reply.code(400).send(sayTwiml("Campaign information is missing for this call."));
    }
    if (!verifyCampaignMediaToken(query.campaignId, query.t)) {
      reply.type("text/xml");
      return reply.code(403).send(sayTwiml("This call is not authorized."));
    }
    const campaign = await prisma.campaign.findUnique({
      where: { id: query.campaignId },
      select: {
        id: true,
        voiceMessage: true,
        voicemailDropEnabled: true,
        voicemailMessage: true,
        voicemailAudioData: true,
        voicemailAudioMimeType: true,
      },
    });
    if (!campaign) {
      reply.type("text/xml");
      return reply.code(404).send(sayTwiml("This campaign is no longer available."));
    }

    const body = (req.body ?? {}) as Record<string, string | undefined>;
    const answeredBy = String(body.AnsweredBy ?? "").toLowerCase();
    const isMachine = answeredBy.includes("machine") || answeredBy.includes("fax");

    if (campaign.voicemailDropEnabled && isMachine) {
      if (campaign.voicemailAudioData && campaign.voicemailAudioMimeType) {
        const base = publicRequestUrl(req).replace(/\/webhooks\/twilio\/voice\/twiml.*$/, "");
        const audioUrl = `${base}/campaigns/${campaign.id}/voicemail-recording?t=${campaignMediaToken(campaign.id)}`;
        reply.type("text/xml");
        return reply.send(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Pause length="1"/><Play>${escapeXml(audioUrl)}</Play></Response>`,
        );
      }
      if (campaign.voicemailMessage?.trim()) {
        reply.type("text/xml");
        return reply.send(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Pause length="1"/><Say voice="Polly.Joanna">${escapeXml(campaign.voicemailMessage.slice(0, 500))}</Say></Response>`,
        );
      }
    }

    reply.type("text/xml");
    return reply.send(sayTwiml(campaign.voiceMessage));
  });

  app.post("/webhooks/twilio/voice", async (req, reply) => {
    const providers = getTwilioWebhookProviders();
    if (!providers) return reply.code(503).send({ error: "Twilio webhook verifier is not configured" });
    const body = req.body as Record<string, string>;
    const signature = req.headers["x-twilio-signature"] as string | undefined;
    const url = publicRequestUrl(req);

    const parsed = providers.dialProvider.parseVoiceWebhook(body, signature, url);
    if ("error" in parsed) {
      return reply.code(403).send({ error: parsed.error });
    }

    await prisma.webhookEvent.create({
      data: {
        provider: "twilio",
        type: "voice",
        rawBody: JSON.stringify(body),
      },
    });

    const attempt = await prisma.callAttempt.findFirst({
      where: { externalCallId: parsed.externalCallId },
    });
    if (!attempt) {
      return reply.code(200).send("OK");
    }

    const disposition = parsed.disposition as CallDisposition;

    await prisma.callAttempt.update({
      where: { id: attempt.id },
      data: { disposition, rawPayload: parsed.raw as object },
    });

    if (isTerminalCallDisposition(disposition)) {
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

    return reply.code(200).send("OK");
  });

  app.post("/webhooks/twilio/sms", async (req, reply) => {
    const providers = getTwilioWebhookProviders();
    if (!providers) return reply.code(503).send({ error: "Twilio webhook verifier is not configured" });
    const body = req.body as Record<string, string>;
    const signature = req.headers["x-twilio-signature"] as string | undefined;
    const url = publicRequestUrl(req);

    const parsed = providers.smsProvider.parseSmsWebhook(body, signature, url);
    if ("error" in parsed) {
      return reply.code(403).send({ error: parsed.error });
    }

    await prisma.webhookEvent.create({
      data: {
        provider: "twilio",
        type: "sms",
        rawBody: JSON.stringify(body),
      },
    });

    const row = await prisma.smsAttempt.findFirst({
      where: { externalMessageId: parsed.externalMessageId },
    });
    if (row) {
      await prisma.smsAttempt.update({
        where: { id: row.id },
        data: { status: mapSmsStatus(parsed.status), rawPayload: parsed.raw as object },
      });
    }

    return reply.code(200).send("OK");
  });

  app.post("/webhooks/vonage/voice", async (req, reply) => {
    const query = req.query as { wt?: string };
    if (!verifyWebhookQueryToken("vonage", query.wt)) {
      return reply.code(403).send({ error: "Invalid webhook token" });
    }
    const providers = getVonageWebhookProviders();
    if (!providers) return reply.code(503).send({ error: "Vonage webhook verifier is not configured" });
    const body = req.body as Record<string, string>;
    const signature = req.headers.authorization as string | undefined;
    const url = publicRequestUrl(req);

    const parsed = providers.dialProvider.parseVoiceWebhook(body, signature, url);
    if ("error" in parsed) {
      return reply.code(403).send({ error: parsed.error });
    }

    await prisma.webhookEvent.create({
      data: {
        provider: "vonage",
        type: "voice",
        rawBody: JSON.stringify(body),
      },
    });

    const attempt = await prisma.callAttempt.findFirst({
      where: { externalCallId: parsed.externalCallId },
    });
    if (!attempt) return reply.code(200).send("OK");

    const disposition = parsed.disposition as CallDisposition;
    await prisma.callAttempt.update({
      where: { id: attempt.id },
      data: { disposition, rawPayload: parsed.raw as object },
    });

    // Answering-machine beep detected: interrupt the call to leave the drop.
    const subState = String(body.sub_state ?? "").toLowerCase();
    const vonageApplicationId = env.VONAGE_APPLICATION_ID ?? "";
    const vonagePrivateKey = env.VONAGE_PRIVATE_KEY ?? "";
    if (
      !env.DEMO_MODE &&
      (subState === "beep_start" || subState === "beep_timeout") &&
      vonageApplicationId.trim() &&
      vonagePrivateKey.trim()
    ) {
      const campaign = await prisma.campaign.findUnique({
        where: { id: attempt.campaignId },
        select: {
          id: true,
          voicemailDropEnabled: true,
          voicemailMessage: true,
          voicemailAudioData: true,
          voicemailAudioMimeType: true,
        },
      });
      if (campaign?.voicemailDropEnabled) {
        const base = (env.PUBLIC_WEBHOOK_BASE_URL ?? env.PUBLIC_BASE_URL).replace(/\/$/, "");
        const audioUrl =
          campaign.voicemailAudioData && campaign.voicemailAudioMimeType
            ? `${base}/campaigns/${campaign.id}/voicemail-recording?t=${campaignMediaToken(campaign.id)}`
            : undefined;
        const drop = await dropVonageVoicemail({
          applicationId: vonageApplicationId,
          privateKey: vonagePrivateKey,
          callUuid: parsed.externalCallId,
          message: campaign.voicemailMessage ?? undefined,
          audioUrl,
        });
        if (!drop.ok) {
          req.log.warn({ error: drop.error }, "Vonage voicemail drop failed");
        }
      }
    }

    if (isTerminalCallDisposition(disposition)) {
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

    return reply.code(200).send("OK");
  });

  // Vonage delivery receipts arrive as POST or GET depending on account settings.
  app.route({
    method: ["GET", "POST"],
    url: "/webhooks/vonage/sms",
    handler: async (req, reply) => {
      const query = req.query as Record<string, string> & { wt?: string };
      if (!verifyWebhookQueryToken("vonage", query.wt)) {
        return reply.code(403).send({ error: "Invalid webhook token" });
      }
      const providers = getVonageWebhookProviders();
      if (!providers) return reply.code(503).send({ error: "Vonage webhook verifier is not configured" });
      const { wt: _wt, ...queryParams } = query;
      const body = { ...queryParams, ...((req.body ?? {}) as Record<string, string>) };
      const signature = req.headers.authorization as string | undefined;
      const url = publicRequestUrl(req);

      const parsed = providers.smsProvider.parseSmsWebhook(body, signature, url);
      if ("error" in parsed) {
        return reply.code(403).send({ error: parsed.error });
      }

      await prisma.webhookEvent.create({
        data: {
          provider: "vonage",
          type: "sms",
          rawBody: JSON.stringify(body),
        },
      });

      const row = await prisma.smsAttempt.findFirst({
        where: { externalMessageId: parsed.externalMessageId },
      });
      if (row) {
        await prisma.smsAttempt.update({
          where: { id: row.id },
          data: { status: mapSmsStatus(parsed.status), rawPayload: parsed.raw as object },
        });
      }
      return reply.code(200).send("OK");
    },
  });
}
