import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../env.js";

/**
 * Deterministic unguessable tokens derived from AUTH_SECRET. Used to protect
 * provider-facing URLs (TwiML, voice instructions, voicemail audio) and
 * webhook endpoints that the provider cannot cryptographically sign.
 */
export function webhookQueryToken(scope: string): string {
  return createHmac("sha256", env.AUTH_SECRET).update(`webhook:${scope}`).digest("hex").slice(0, 32);
}

export function verifyWebhookQueryToken(scope: string, provided: string | undefined): boolean {
  if (!provided) return false;
  const expected = webhookQueryToken(scope);
  const a = Buffer.from(String(provided));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function campaignMediaToken(campaignId: string): string {
  return webhookQueryToken(`campaign:${campaignId}`);
}

/** D5(a): short-TTL signed media token (default 5 minutes). */
export function campaignMediaTokenTtl(campaignId: string, ttlSec = 300): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = createHmac("sha256", env.AUTH_SECRET)
    .update(`campaign-ttl:${campaignId}:${exp}`)
    .digest("hex")
    .slice(0, 24);
  return `${exp}.${sig}`;
}

function verifyCampaignMediaTokenTtl(campaignId: string, provided: string): boolean {
  const [expStr, sig] = provided.split(".");
  const exp = Number(expStr);
  if (!expStr || !sig || !Number.isFinite(exp)) return false;
  if (Math.floor(Date.now() / 1000) > exp) return false;
  const expected = createHmac("sha256", env.AUTH_SECRET)
    .update(`campaign-ttl:${campaignId}:${exp}`)
    .digest("hex")
    .slice(0, 24);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Accept short-TTL tokens (preferred) or legacy non-expiring HMAC tokens
 * (remain valid until callers stop issuing them — URL-leak mitigation note).
 */
export function verifyCampaignMediaToken(campaignId: string, provided: string | undefined): boolean {
  if (!provided) return false;
  if (provided.includes(".")) return verifyCampaignMediaTokenTtl(campaignId, provided);
  return verifyWebhookQueryToken(`campaign:${campaignId}`, provided);
}
