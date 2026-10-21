import { randomUUID } from "node:crypto";
import type { CallDisposition } from "@prisma/client";
import type { Job } from "bullmq";
import { prisma } from "../db.js";
import { getDialProvider, getPreferredIntegrationKey } from "../providers.js";
import { env } from "../env.js";
import { enqueueDialNext } from "../queueEnqueue.js";
import type { DialNextJob } from "../queues.js";
import { isTerminalCallDisposition } from "../lib/dispositions.js";
import {
  classifyProviderFailure,
  inferCountryFromE164,
  jitterDelayMs,
} from "../lib/providerFailure.js";
import { recordProviderOutcome, selectProviderForCountry } from "../lib/providerRouting.js";
import { isBridgeProvider, voiceWebhookUrl } from "../lib/bridgeWebhookUrl.js";
import { resolveAgentZoomUserId } from "../lib/zoomPhoneAgent.js";
import { campaignMediaToken } from "../lib/webhookToken.js";

function voiceTwimlUrl(campaignId: string, contactId: string): string {
  const base = env.PUBLIC_BASE_URL.replace(/\/$/, "");
  const params = new URLSearchParams({ campaignId, contactId, t: campaignMediaToken(campaignId) });
  return `${base}/webhooks/twilio/voice/twiml?${params.toString()}`;
}

function voiceInstructionsUrl(campaignId: string, contactId: string): string {
  const base = env.PUBLIC_BASE_URL.replace(/\/$/, "");
  const params = new URLSearchParams({ contactId, t: campaignMediaToken(campaignId) });
  return `${base}/campaigns/${campaignId}/voice-instructions?${params.toString()}`;
}

function voicemailRecordingUrl(campaignId: string): string {
  const base = env.PUBLIC_BASE_URL.replace(/\/$/, "");
  return `${base}/campaigns/${campaignId}/voicemail-recording?t=${campaignMediaToken(campaignId)}`;
}

/** A live call older than this is considered lost (missed terminal webhook). */
const STALE_CALL_MS = 5 * 60 * 1000;

export async function processDialNext(job: Job<DialNextJob>): Promise<void> {
  const { campaignId } = job.data;

  // Select only what dialing needs; the voicemail audio blob itself is served
  // to providers via voicemailRecordingUrl, so we just need to know it exists.
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      status: true,
      kind: true,
      startedByUserId: true,
      fromPhone: true,
      voiceMessage: true,
      voicemailDropEnabled: true,
      voicemailMessage: true,
      voicemailAudioMimeType: true,
    },
  });
  if (!campaign || campaign.status !== "RUNNING") return;
  if (campaign.kind === "SMS") return;

  const terminal: CallDisposition[] = [
    "COMPLETED",
    "BUSY",
    "NO_ANSWER",
    "FAILED",
    "CANCELED",
  ];
  const active = await prisma.callAttempt.findFirst({
    where: {
      campaignId,
      disposition: { notIn: terminal },
    },
  });
  if (active) {
    const ageMs = Date.now() - active.updatedAt.getTime();
    if (ageMs < STALE_CALL_MS) return;
    // Watchdog: the terminal webhook never arrived. Close the attempt so the
    // campaign is not stuck forever, then continue to the next contact.
    await prisma.callAttempt.update({
      where: { id: active.id },
      data: {
        disposition: "FAILED",
        rawPayload: { reason: "stale_call_timeout", staleAfterMs: STALE_CALL_MS } as object,
      },
    });
    await prisma.contact.updateMany({
      where: { id: active.contactId, status: { in: ["DIALING", "PENDING"] } },
      data: { status: "DIALED" },
    });
  }

  const campaignMeta = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { organizationId: true },
  });
  const dnc = new Set(
    (
      await prisma.dncEntry.findMany({
        where: campaignMeta?.organizationId
          ? { organizationId: campaignMeta.organizationId }
          : undefined,
        select: { e164: true },
      })
    ).map((r) => r.e164),
  );

  const pending = await prisma.contact.findMany({
    where: { campaignId, status: "PENDING" },
    orderBy: { createdAt: "asc" },
    select: { id: true, phoneE164: true },
  });

  let next: (typeof pending)[0] | undefined;
  const dncSkipIds: string[] = [];
  for (const c of pending) {
    if (dnc.has(c.phoneE164)) {
      dncSkipIds.push(c.id);
      continue;
    }
    next = c;
    break;
  }
  if (dncSkipIds.length) {
    await prisma.contact.updateMany({
      where: { id: { in: dncSkipIds } },
      data: { status: "SKIPPED" },
    });
  }

  if (!next) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "COMPLETED" },
    });
    return;
  }

  const idempotencyKey = `call:${next.id}`;
  const preferred = await getPreferredIntegrationKey(async () => {
    if (campaignMeta?.organizationId) {
      return prisma.integrationPreference.findUnique({
        where: { organizationId: campaignMeta.organizationId },
        select: { preferredIntegrationKey: true },
      });
    }
    return prisma.integrationPreference.findFirst({
      select: { preferredIntegrationKey: true },
    });
  });
  const country = inferCountryFromE164(next.phoneE164);
  const selectedProvider = selectProviderForCountry({
    preferred,
    country,
    capability: "voice",
    fallback: "twilio",
  });
  const dialProvider = getDialProvider(selectedProvider);

  const existing = await prisma.callAttempt.findUnique({
    where: { idempotencyKey },
  });
  if (existing && !isTerminalCallDisposition(existing.disposition)) {
    return;
  }
  if (existing && isTerminalCallDisposition(existing.disposition)) {
    const retryable =
      existing.disposition === "FAILED" &&
      typeof existing.rawPayload === "object" &&
      existing.rawPayload !== null &&
      "retryable" in (existing.rawPayload as Record<string, unknown>) &&
      Boolean((existing.rawPayload as Record<string, unknown>).retryable);
    if (retryable) {
      await prisma.callAttempt.delete({ where: { id: existing.id } });
    } else {
      await prisma.contact.updateMany({
        where: { id: next.id, status: { not: "DIALED" } },
        data: { status: "DIALED" },
      });
      await enqueueDialNext(campaignId, { delay: 100 });
      return;
    }
  }

  if (existing) {
    await prisma.contact.updateMany({
      where: { id: next.id, status: { not: "DIALED" } },
      data: { status: "PENDING" },
    });
  }

  await prisma.contact.update({
    where: { id: next.id },
    data: { status: "DIALING" },
  });

  const attempt = await prisma.callAttempt.create({
    data: {
      campaignId,
      contactId: next.id,
      idempotencyKey,
      disposition: "QUEUED",
    },
  });

  const bridgeDial = isBridgeProvider(selectedProvider);
  const orgId = campaignMeta?.organizationId ?? null;
  const agentZoomUserId = bridgeDial
    ? await resolveAgentZoomUserId(campaign.startedByUserId, orgId)
    : undefined;
  const zoomCredentials =
    selectedProvider === "zoom_phone" && orgId
      ? await (await import("../lib/zoomOrgCredentials.js")).loadZoomOrgCredentials(orgId)
      : selectedProvider === "zoom_phone"
        ? await (await import("../lib/zoomOrgCredentials.js")).loadZoomOrgCredentials(null)
        : null;

  const result = await dialProvider.placeCall({
    toE164: next.phoneE164,
    fromE164: campaign.fromPhone,
    campaignId,
    contactId: next.id,
    statusCallbackUrl: voiceWebhookUrl(selectedProvider),
    twimlUrl: voiceTwimlUrl(campaignId, next.id),
    voiceInstructionsUrl: voiceInstructionsUrl(campaignId, next.id),
    voiceMessage: campaign.voiceMessage,
    voicemailDropEnabled: campaign.voicemailDropEnabled,
    voicemailMessage: campaign.voicemailMessage ?? undefined,
    voicemailAudioUrl: campaign.voicemailAudioMimeType ? voicemailRecordingUrl(campaignId) : undefined,
    voicemailAudioMimeType: campaign.voicemailAudioMimeType ?? undefined,
    idempotencyKey,
    ...(bridgeDial
      ? {
          agentZoomUserId,
          callType: campaign.voicemailDropEnabled ? ("broadcast" as const) : ("agent" as const),
          correlationId: randomUUID(),
        }
      : {}),
    ...(zoomCredentials ? { zoomCredentials } : {}),
  });

  if (!result.ok) {
    const failure = classifyProviderFailure(result.error);
    recordProviderOutcome({
      provider: selectedProvider,
      country,
      capability: "voice",
      ok: false,
      retryableFailure: failure.retryable,
    });
    job.log(
      JSON.stringify({
        event: "dial.place_call_failed",
        provider: selectedProvider,
        country,
        errorCode: failure.errorCode,
        retryable: failure.retryable,
      }),
    );
    await prisma.callAttempt.update({
      where: { id: attempt.id },
      data: {
        disposition: "FAILED",
        rawPayload: {
          provider: selectedProvider,
          country,
          errorCode: failure.errorCode,
          retryable: failure.retryable,
          error: failure.rawError,
        } as object,
      },
    });
    await prisma.contact.update({
      where: { id: next.id },
      data: { status: failure.retryable ? "PENDING" : "DIALED" },
    });
    await enqueueDialNext(campaignId, { delay: jitterDelayMs(failure.retryable ? 1200 : 500) });
    return;
  }
  recordProviderOutcome({
    provider: selectedProvider,
    country,
    capability: "voice",
    ok: true,
    retryableFailure: false,
  });

  await prisma.callAttempt.update({
    where: { id: attempt.id },
    data: { externalCallId: result.externalCallId, disposition: "QUEUED" },
  });

  if (!env.DEMO_MODE) {
    // Watchdog re-check: if the provider never reports a terminal status, this
    // delayed job expires the stale attempt and keeps the campaign moving.
    await enqueueDialNext(campaignId, { delay: STALE_CALL_MS + 15_000 });
  }

  if (env.DEMO_MODE && !env.DEMO_USE_BRIDGE) {
    const attemptId = attempt.id;
    const contactPk = next.id;
    setTimeout(() => {
      void (async () => {
        await prisma.callAttempt.update({
          where: { id: attemptId },
          data: { disposition: "COMPLETED", rawPayload: { demo: true } as object },
        });
        await prisma.contact.update({
          where: { id: contactPk },
          data: { status: "DIALED" },
        });
        const camp = await prisma.campaign.findUnique({
          where: { id: campaignId },
          select: { status: true },
        });
        if (camp?.status === "RUNNING") await enqueueDialNext(campaignId);
      })().catch(console.error);
    }, 1200);
  }
}
