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

export function verifyCampaignMediaToken(campaignId: string, provided: string | undefined): boolean {
  return verifyWebhookQueryToken(`campaign:${campaignId}`, provided);
}
