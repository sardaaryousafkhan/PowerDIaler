import { env } from "./env.js";
import type { DialNextJob, SmsSendJob } from "./queues.js";

export async function enqueueDialNext(campaignId: string, opts?: { delay?: number }): Promise<void> {
  const delay = opts?.delay ?? 0;
  if (env.DEMO_MODE) {
    const { scheduleDialNext } = await import("./demoQueue.js");
    scheduleDialNext(campaignId, delay);
    return;
  }
  const { dialNextQueue } = await import("./queuesBull.js");
  await dialNextQueue.add("dial-next", { campaignId } satisfies DialNextJob, { delay });
}

export async function enqueueSms(
  job: SmsSendJob,
  opts: { delay: number; jobId: string },
): Promise<void> {
  if (env.DEMO_MODE) {
    const { scheduleSmsSend } = await import("./demoQueue.js");
    scheduleSmsSend(job, opts.delay, opts.jobId);
    return;
  }
  const { smsSendQueue } = await import("./queuesBull.js");
  await smsSendQueue.add("sms-send", job, { delay: opts.delay, jobId: opts.jobId });
}

/** Schedules the next progressive SMS campaign tick (one contact per spacing interval). */
export async function enqueueSmsCampaignTick(campaignId: string, delayMs = 0): Promise<void> {
  if (env.DEMO_MODE) {
    const { scheduleSmsCampaignTick } = await import("./demoQueue.js");
    scheduleSmsCampaignTick(campaignId, delayMs);
    return;
  }
  const { smsSendQueue } = await import("./queuesBull.js");
  // Reuse sms queue with a distinct job name; worker must route by name.
  await smsSendQueue.add(
    "sms-campaign-tick",
    { campaignId } as unknown as SmsSendJob,
    {
      delay: delayMs,
      jobId: `sms-tick-${campaignId}-${Date.now()}`,
    },
  );
}
