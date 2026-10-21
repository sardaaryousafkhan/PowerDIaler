import type { IntegrationProviderId } from "@powerdialer/shared";
import { env } from "../env.js";
import { webhookQueryToken } from "./webhookToken.js";

const BRIDGE_PROVIDER_IDS = new Set<IntegrationProviderId>([
  "google_voice",
  "callhippo",
  "ringcentral",
  "nextiva",
  "dialpad",
  "zoom_phone",
  "aircall",
  "8x8",
  "ooma_office",
  "microsoft_teams_phone",
  "custom_integration",
]);

export function isBridgeProvider(provider: IntegrationProviderId): boolean {
  return BRIDGE_PROVIDER_IDS.has(provider);
}

function baseUrl(): string {
  return env.PUBLIC_BASE_URL.replace(/\/$/, "");
}

export function voiceWebhookUrl(provider: IntegrationProviderId): string {
  if (isBridgeProvider(provider)) return `${baseUrl()}/webhooks/bridge/voice`;
  if (provider === "vonage") {
    // Vonage cannot always sign voice events; an unguessable token in the URL
    // is the documented fallback protection.
    return `${baseUrl()}/webhooks/vonage/voice?wt=${webhookQueryToken("vonage")}`;
  }
  return `${baseUrl()}/webhooks/twilio/voice`;
}

export function smsWebhookUrl(provider: IntegrationProviderId): string | undefined {
  if (isBridgeProvider(provider)) return `${baseUrl()}/webhooks/bridge/sms`;
  if (provider === "vonage") {
    return `${baseUrl()}/webhooks/vonage/sms?wt=${webhookQueryToken("vonage")}`;
  }
  // WhatsApp Cloud has no per-message status callback URL; do not point it at
  // the Twilio webhook (statuses would be rejected by the Twilio verifier).
  if (provider === "whatsapp") return undefined;
  return `${baseUrl()}/webhooks/twilio/sms`;
}
