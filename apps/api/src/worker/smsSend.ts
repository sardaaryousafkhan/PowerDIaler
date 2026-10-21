import type { Job } from "bullmq";
import { prisma } from "../db.js";
import { getPreferredIntegrationKey, getSmsProvider } from "../providers.js";
import { env } from "../env.js";
import type { SmsSendJob } from "../queues.js";
import {
  classifyProviderFailure,
  inferCountryFromE164,
  jitterDelayMs,
} from "../lib/providerFailure.js";
import { enqueueSms } from "../queueEnqueue.js";
import { recordProviderOutcome, selectProviderForCountry } from "../lib/providerRouting.js";
import { smsWebhookUrl } from "../lib/bridgeWebhookUrl.js";
import { normalizeSmsBody, wasRecentlySentSameSms } from "../lib/smsDuplicateGuard.js";

export async function processSmsSend(job: Job<SmsSendJob>): Promise<void> {
  const { campaignId, contactId, body: rawBody } = job.data;
  const body = normalizeSmsBody(rawBody);

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { fromPhone: true, organizationId: true },
  });
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { campaignId: true, phoneE164: true },
  });
  if (!campaign || !contact || contact.campaignId !== campaignId) return;

  const dnc = campaign.organizationId
    ? await prisma.dncEntry.findUnique({
        where: {
          organizationId_e164: {
            organizationId: campaign.organizationId,
            e164: contact.phoneE164,
          },
        },
      })
    : await prisma.dncEntry.findFirst({ where: { e164: contact.phoneE164 } });
  if (dnc) {
    await prisma.smsAttempt.create({
      data: {
        campaignId,
        contactId,
        idempotencyKey: `sms:${contactId}:${job.id}`,
        status: "FAILED",
        body,
        rawPayload: { reason: "DNC" } as object,
      },
    });
    await prisma.contact.update({
      where: { id: contactId },
      data: { status: "SKIPPED" },
    });
    return;
  }

  const dup = await wasRecentlySentSameSms({
    phoneE164: contact.phoneE164,
    body,
    organizationId: campaign.organizationId,
  });
  if (dup.duplicate) {
    await prisma.smsAttempt.create({
      data: {
        campaignId,
        contactId,
        idempotencyKey: `sms:${contactId}:${job.id}:dedup`,
        status: "FAILED",
        body,
        rawPayload: {
          reason: "DUPLICATE_WITHIN_WINDOW",
          windowDays: env.SMS_DEDUP_DAYS,
          priorAttemptId: dup.priorAttemptId,
          priorSentAt: dup.sentAt.toISOString(),
        } as object,
      },
    });
    await prisma.contact.update({
      where: { id: contactId },
      data: { status: "SKIPPED" },
    });
    job.log?.(
      JSON.stringify({
        event: "sms.skipped_duplicate",
        phoneE164: contact.phoneE164,
        priorAttemptId: dup.priorAttemptId,
        windowDays: env.SMS_DEDUP_DAYS,
      }),
    );
    return;
  }

  const idempotencyKey = `sms:${contactId}:${job.id ?? "x"}`;
  const preferred = await getPreferredIntegrationKey(async () => {
    if (campaign.organizationId) {
      return prisma.integrationPreference.findUnique({
        where: { organizationId: campaign.organizationId },
        select: { preferredIntegrationKey: true },
      });
    }
    return prisma.integrationPreference.findFirst({
      select: { preferredIntegrationKey: true },
    });
  });
  const country = inferCountryFromE164(contact.phoneE164);
  const channelCapability = preferred === "whatsapp" ? "messaging" : "sms";
  const selectedProvider = selectProviderForCountry({
    preferred,
    country,
    capability: channelCapability,
    fallback: "twilio",
  });
  const smsProvider = getSmsProvider(selectedProvider);
  const zoomCredentials =
    selectedProvider === "zoom_phone"
      ? await (await import("../lib/zoomOrgCredentials.js")).loadZoomOrgCredentials(
          campaign.organizationId,
        )
      : null;

  const result = await smsProvider.sendSms({
    toE164: contact.phoneE164,
    fromE164: campaign.fromPhone,
    body,
    idempotencyKey,
    statusCallbackUrl: smsWebhookUrl(selectedProvider),
    ...(zoomCredentials ? { zoomCredentials } : {}),
  });

  if (!result.ok) {
    const failure = classifyProviderFailure(result.error);
    recordProviderOutcome({
      provider: selectedProvider,
      country,
      capability: channelCapability,
      ok: false,
      retryableFailure: failure.retryable,
    });
    job.log?.(
      JSON.stringify({
        event: "sms.send_failed",
        provider: selectedProvider,
        country,
        errorCode: failure.errorCode,
        retryable: failure.retryable,
      }),
    );
    await prisma.smsAttempt.create({
      data: {
        campaignId,
        contactId,
        idempotencyKey,
        status: "FAILED",
        body,
        rawPayload: {
          provider: selectedProvider,
          country,
          errorCode: failure.errorCode,
          retryable: failure.retryable,
          error: failure.rawError,
        } as object,
      },
    });
    if (failure.retryable) {
      await enqueueSms(
        { campaignId, contactId, body },
        { delay: jitterDelayMs(1500), jobId: `sms-retry-${campaignId}-${contactId}-${Date.now()}` },
      );
    }
    return;
  }
  recordProviderOutcome({
    provider: selectedProvider,
    country,
    capability: channelCapability,
    ok: true,
    retryableFailure: false,
  });

  // Bridge / carrier accepted the message → SENT. Delivery webhooks may later promote to DELIVERED.
  const initialStatus =
    env.DEMO_MODE && !env.DEMO_USE_BRIDGE ? "QUEUED" : result.externalMessageId ? "SENT" : "QUEUED";

  const row = await prisma.smsAttempt.create({
    data: {
      campaignId,
      contactId,
      externalMessageId: result.externalMessageId,
      idempotencyKey,
      status: initialStatus,
      body,
    },
  });

  if (env.DEMO_MODE && !env.DEMO_USE_BRIDGE) {
    setTimeout(() => {
      void prisma.smsAttempt
        .update({
          where: { id: row.id },
          data: { status: "DELIVERED", rawPayload: { demo: true } as object },
        })
        .catch(console.error);
    }, 600);
  }
}
