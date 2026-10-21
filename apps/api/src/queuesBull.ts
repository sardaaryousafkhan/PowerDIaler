import { Queue } from "bullmq";
import { getRedis } from "./redis.js";

export const DIAL_NEXT_QUEUE = "dial-next";
export const SMS_SEND_QUEUE = "sms-send";

const redis = getRedis();

export const dialNextQueue = new Queue(DIAL_NEXT_QUEUE, {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: 1000,
    removeOnFail: 5000,
    attempts: 5,
    backoff: { type: "exponential", delay: 2000 },
  },
});

export const smsSendQueue = new Queue(SMS_SEND_QUEUE, {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: 1000,
    removeOnFail: 5000,
    attempts: 5,
    backoff: { type: "exponential", delay: 2000 },
  },
});
