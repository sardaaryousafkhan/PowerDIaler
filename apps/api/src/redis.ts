import { Redis } from "ioredis";
import { env } from "./env.js";

function assertRedis(): Redis {
  if (env.DEMO_MODE) {
    throw new Error("Redis is not used in DEMO_MODE");
  }
  const url = env.REDIS_URL;
  if (!url?.trim()) throw new Error("REDIS_URL is required outside DEMO_MODE");
  return new Redis(url, { maxRetriesPerRequest: null });
}

let _redis: Redis | undefined;

export function getRedis(): Redis {
  if (env.DEMO_MODE) {
    throw new Error("Redis is not used in DEMO_MODE");
  }
  if (!_redis) _redis = assertRedis();
  return _redis;
}
