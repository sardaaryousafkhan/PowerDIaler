import { prisma } from "../db.js";
import { enqueueDialNext, enqueueSmsCampaignTick } from "../queueEnqueue.js";

/** If a RUNNING campaign has pending work but no recent attempt, treat the send loop as stalled. */
const STALL_AFTER_MS = 35_000;

/**
 * Demo/bridge mode stores the send loop in process memory (setTimeout).
 * Those timers pause or die when the Mac sleeps / the API restarts.
 * Re-queue work so sending continues without a manual Resume click.
 */
export async function recoverRunningCampaignQueues(opts?: {
  reason?: string;
  /** Only resume campaigns that look stalled (default true for watchdog). */
  onlyIfStalled?: boolean;
}): Promise<void> {
  const reason = opts?.reason ?? "recover";
  const onlyIfStalled = opts?.onlyIfStalled ?? false;

  const running = await prisma.campaign.findMany({
    where: { status: "RUNNING" },
    select: { id: true, kind: true, name: true, updatedAt: true },
  });
  if (running.length === 0) return;

  for (const campaign of running) {
    // Unstick contacts left mid-claim when the process froze mid-send.
    await prisma.contact.updateMany({
      where: { campaignId: campaign.id, status: "DIALING" },
      data: { status: "PENDING" },
    });

    const pending = await prisma.contact.count({
      where: { campaignId: campaign.id, status: "PENDING" },
    });
    if (pending === 0) {
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: "COMPLETED" },
      });
      console.info(
        `[${reason}] ${campaign.kind} "${campaign.name}" had no pending contacts; marked COMPLETED`,
      );
      continue;
    }

    if (onlyIfStalled) {
      const lastAttempt =
        campaign.kind === "SMS"
          ? await prisma.smsAttempt.findFirst({
              where: { campaignId: campaign.id },
              orderBy: { createdAt: "desc" },
              select: { createdAt: true },
            })
          : await prisma.callAttempt.findFirst({
              where: { campaignId: campaign.id },
              orderBy: { createdAt: "desc" },
              select: { createdAt: true },
            });
      const lastAt = lastAttempt?.createdAt ?? campaign.updatedAt;
      const idleMs = Date.now() - lastAt.getTime();
      if (idleMs < STALL_AFTER_MS) continue;
      console.info(
        `[${reason}] "${campaign.name}" stalled for ${Math.round(idleMs / 1000)}s — resuming`,
      );
    }

    if (campaign.kind === "SMS") {
      await enqueueSmsCampaignTick(campaign.id, 0);
      console.info(`[${reason}] resumed SMS campaign "${campaign.name}" (${pending} pending)`);
      continue;
    }

    await enqueueDialNext(campaign.id);
    console.info(`[${reason}] resumed call campaign "${campaign.name}" (${pending} pending)`);
  }
}

/** Periodically resume RUNNING campaigns after Mac sleep / frozen timers. */
export function startCampaignWatchdog(): void {
  const periodMs = 20_000;
  setInterval(() => {
    void recoverRunningCampaignQueues({ reason: "watchdog", onlyIfStalled: true }).catch((err) => {
      console.error("[watchdog] recover failed", err);
    });
  }, periodMs);
  console.info(`[watchdog] checking for stalled campaigns every ${periodMs / 1000}s`);
}
