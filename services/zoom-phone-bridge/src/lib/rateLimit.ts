import { createHash } from "node:crypto";

const buckets = new Map<string, { tokens: number; lastRefill: number }>();

export function consumeToken(key: string, ratePerSec = 2, burst = 4): boolean {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: burst, lastRefill: now };
    buckets.set(key, bucket);
  }
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(burst, bucket.tokens + elapsed * ratePerSec);
  bucket.lastRefill = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

/** Build a stable rate-limit key from route + caller identity. */
export function rateLimitKey(route: string, apiKey: string | undefined): string {
  if (!apiKey) return `${route}:anon`;
  const fp = createHash("sha256").update(apiKey).digest("hex").slice(0, 12);
  return `${route}:${fp}`;
}
