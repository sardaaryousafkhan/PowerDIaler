import "dotenv/config";
import type { Job } from "bullmq";
import { env } from "./env.js";
import type { DialNextJob, SmsSendJob } from "./queues.js";

if (env.DEMO_MODE) {
  console.log("DEMO_MODE is on: you do not need a separate worker process.");
  process.exit(0);
}

const { Worker } = await import("bullmq");
const { getRedis } = await import("./redis.js");
const { DIAL_NEXT_QUEUE, SMS_SEND_QUEUE } = await import("./queuesBull.js");
const { processDialNext } = await import("./worker/dialNext.js");
const { processSmsSend } = await import("./worker/smsSend.js");
const { processSmsCampaignTick } = await import("./worker/smsCampaignTick.js");
const { startProviderCredentialRefresh } = await import("./lib/envReload.js");

const redis = getRedis();

// Pick up credentials saved from the Integrations page without a restart.
startProviderCredentialRefresh();

const dialWorker = new Worker<DialNextJob>(
  DIAL_NEXT_QUEUE,
  async (job: Job<DialNextJob>) => {
    await processDialNext(job);
  },
  // Concurrency must stay 1: the "one live call per campaign" check in
  // processDialNext is not transactional, so parallel jobs can double-dial.
  { connection: redis, concurrency: 1 },
);

const smsWorker = new Worker<SmsSendJob>(
  SMS_SEND_QUEUE,
  async (job: Job<SmsSendJob>) => {
    if (job.name === "sms-campaign-tick") {
      await processSmsCampaignTick(job.data.campaignId);
      return;
    }
    await processSmsSend(job);
  },
  { connection: redis, concurrency: 1, limiter: { max: 2, duration: 1000 } },
);

dialWorker.on("failed", (job, err) => {
  console.error("[dial-worker] job failed", job?.id, err);
});
smsWorker.on("failed", (job, err) => {
  console.error("[sms-worker] job failed", job?.id, err);
});

console.log(`Workers up (${env.NODE_ENV}) — dial + sms`);
