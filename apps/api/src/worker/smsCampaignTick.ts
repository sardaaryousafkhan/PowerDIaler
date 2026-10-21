import { prisma } from "../db.js";
import { SMS_PER_MINUTE_DEFAULT, smsDelayMsForRate } from "@powerdialer/shared";
import { enqueueSms, enqueueSmsCampaignTick } from "../queueEnqueue.js";
import { env } from "../env.js";
import { normalizeSmsBody, wasRecentlySentSameSms } from "../lib/smsDuplicateGuard.js";

/**
 * Progressive SMS sender for large lists.
 * Sends one PENDING contact, then schedules the next tick after the configured spacing.
 * Always re-schedules on error so a single failure cannot leave the campaign stuck.
 */
export async function processSmsCampaignTick(campaignId: string): Promise<void> {
  let scheduleDelayMs: number | null = null;

  try {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, kind: true, status: true, smsTemplate: true },
    });
    if (!campaign || campaign.kind !== "SMS") return;
    if (campaign.status !== "RUNNING") return;

    const body = normalizeSmsBody(campaign.smsTemplate ?? "");
    if (!body) {
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { status: "PAUSED" },
      });
      console.error("[sms-campaign-tick] missing smsTemplate; paused", campaignId);
      return;
    }

    const next = await prisma.contact.findFirst({
      where: { campaignId, status: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: { id: true, phoneE164: true },
    });

    if (!next) {
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { status: "COMPLETED" },
      });
      return;
    }

    // Claim contact before send so a double-tick cannot duplicate.
    const claimed = await prisma.contact.updateMany({
      where: { id: next.id, status: "PENDING" },
      data: { status: "DIALING" },
    });
    if (claimed.count === 0) {
      scheduleDelayMs = 50;
      return;
    }

  const campaignOrg = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { organizationId: true },
  });
  const preference = campaignOrg?.organizationId
    ? await prisma.integrationPreference.findUnique({
        where: { organizationId: campaignOrg.organizationId },
      })
    : await prisma.integrationPreference.findFirst();
  const smsPerMinute = preference?.smsPerMinute ?? SMS_PER_MINUTE_DEFAULT;
    const spacingMs = smsDelayMsForRate(smsPerMinute);

    const dup = await wasRecentlySentSameSms({
      phoneE164: next.phoneE164,
      body,
      organizationId: campaignOrg?.organizationId,
    });
    if (dup.duplicate) {
      await prisma.smsAttempt.create({
        data: {
          campaignId,
          contactId: next.id,
          idempotencyKey: `sms:${next.id}:dedup:${Date.now()}`,
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
        where: { id: next.id },
        data: { status: "SKIPPED" },
      });
      // Skip quickly — do not consume rate-limit spacing for suppressed sends.
      scheduleDelayMs = 25;
      return;
    }

    await enqueueSms(
      { campaignId, contactId: next.id, body },
      { delay: 0, jobId: `sms-${campaignId}-${next.id}-${Date.now()}` },
    );

    await prisma.contact.update({
      where: { id: next.id },
      data: { status: "DIALED" },
    });

    const morePending = await prisma.contact.findFirst({
      where: { campaignId, status: "PENDING" },
      select: { id: true },
    });
    if (!morePending) {
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { status: "COMPLETED" },
      });
      return;
    }

    scheduleDelayMs = spacingMs;
  } catch (err) {
    console.error("[sms-campaign-tick] failed; will retry", campaignId, err);
    // Unstick any contact left in DIALING from this interrupted tick.
    await prisma.contact
      .updateMany({
        where: { campaignId, status: "DIALING" },
        data: { status: "PENDING" },
      })
      .catch(() => undefined);
    scheduleDelayMs = 2_000;
  } finally {
    if (scheduleDelayMs == null) return;
    const still = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { status: true },
    });
    if (still?.status === "RUNNING") {
      await enqueueSmsCampaignTick(campaignId, scheduleDelayMs);
    }
  }
}
