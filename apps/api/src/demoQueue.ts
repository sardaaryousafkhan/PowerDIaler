import type { Job } from "bullmq";
import type { DialNextJob, SmsSendJob } from "./queues.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function asDialJob(campaignId: string): Job<DialNextJob> {
  return {
    data: { campaignId },
    id: `demo-dial-${Date.now()}`,
    log: async () => 0,
  } as unknown as Job<DialNextJob>;
}

function asSmsJob(data: SmsSendJob, id: string): Job<SmsSendJob> {
  return {
    data,
    id,
    log: async () => 0,
  } as unknown as Job<SmsSendJob>;
}

/**
 * Demo / bridge-local queue.
 * Delays are absolute from schedule time (same semantics as BullMQ `delay`),
 * NOT chained cumulative waits.
 */
export function scheduleDialNext(campaignId: string, delayMs = 0): void {
  setTimeout(() => {
    void (async () => {
      try {
        if (delayMs > 0) await sleep(0); // delay already applied by setTimeout
        const { processDialNext } = await import("./worker/dialNext.js");
        await processDialNext(asDialJob(campaignId));
      } catch (err) {
        console.error("[demo-queue] dial-next failed", err);
      }
    })();
  }, Math.max(0, delayMs));
}

export function scheduleSmsSend(job: SmsSendJob, delayMs: number, jobId: string): void {
  setTimeout(() => {
    void (async () => {
      try {
        const { processSmsSend } = await import("./worker/smsSend.js");
        await processSmsSend(asSmsJob(job, jobId));
      } catch (err) {
        console.error("[demo-queue] sms failed", err);
      }
    })();
  }, Math.max(0, delayMs));
}

export function scheduleSmsCampaignTick(campaignId: string, delayMs = 0): void {
  setTimeout(() => {
    void (async () => {
      try {
        const { processSmsCampaignTick } = await import("./worker/smsCampaignTick.js");
        await processSmsCampaignTick(campaignId);
      } catch (err) {
        console.error("[demo-queue] sms-campaign-tick failed", err);
      }
    })();
  }, Math.max(0, delayMs));
}
