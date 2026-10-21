import {
  createHttpBridgeDialProvider,
  createHttpBridgeSmsProvider,
  createTwilioDialProvider,
  createTwilioSmsProvider,
  createVonageDialProvider,
  createVonageSmsProvider,
  createWhatsAppCloudSmsProvider,
  type DialProvider,
  type SmsProvider,
} from "@powerdialer/providers";
import {
  coerceIntegrationProviderId,
  getIntegrationCatalogEntry,
  resolveIntegrationProviderId,
  type IntegrationCapability,
  type IntegrationProviderId,
} from "@powerdialer/shared";
import { env } from "./env.js";
import { createDemoDialProvider, createDemoSmsProvider } from "./demoProviders.js";

function twilioAuth(): { accountSid: string; authToken: string } {
  const accountSid = env.TWILIO_ACCOUNT_SID;
  const authToken = env.TWILIO_AUTH_TOKEN;
  if (!accountSid?.trim() || !authToken?.trim()) {
    throw new Error("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required outside DEMO_MODE");
  }
  return { accountSid, authToken };
}

function requireBridgeBaseUrl(raw: string | undefined, name: string): string {
  if (!raw?.trim()) {
    throw new Error(`${name} is required for this integration`);
  }
  return raw;
}

function bridgeConfig(provider: IntegrationProviderId): { baseUrl: string; apiKey?: string } | null {
  switch (provider) {
    case "google_voice":
      return {
        baseUrl: requireBridgeBaseUrl(env.GOOGLE_VOICE_BRIDGE_BASE_URL, "GOOGLE_VOICE_BRIDGE_BASE_URL"),
        apiKey: env.GOOGLE_VOICE_BRIDGE_API_KEY,
      };
    case "callhippo":
      return {
        baseUrl: requireBridgeBaseUrl(env.CALLHIPPO_BRIDGE_BASE_URL, "CALLHIPPO_BRIDGE_BASE_URL"),
        apiKey: env.CALLHIPPO_BRIDGE_API_KEY,
      };
    case "ringcentral":
      return {
        baseUrl: requireBridgeBaseUrl(env.RINGCENTRAL_BRIDGE_BASE_URL, "RINGCENTRAL_BRIDGE_BASE_URL"),
        apiKey: env.RINGCENTRAL_BRIDGE_API_KEY,
      };
    case "nextiva":
      return {
        baseUrl: requireBridgeBaseUrl(env.NEXTIVA_BRIDGE_BASE_URL, "NEXTIVA_BRIDGE_BASE_URL"),
        apiKey: env.NEXTIVA_BRIDGE_API_KEY,
      };
    case "dialpad":
      return {
        baseUrl: requireBridgeBaseUrl(env.DIALPAD_BRIDGE_BASE_URL, "DIALPAD_BRIDGE_BASE_URL"),
        apiKey: env.DIALPAD_BRIDGE_API_KEY,
      };
    case "zoom_phone":
      return {
        baseUrl: requireBridgeBaseUrl(env.ZOOM_PHONE_BRIDGE_BASE_URL, "ZOOM_PHONE_BRIDGE_BASE_URL"),
        apiKey: env.ZOOM_PHONE_BRIDGE_API_KEY,
      };
    case "aircall":
      return {
        baseUrl: requireBridgeBaseUrl(env.AIRCALL_BRIDGE_BASE_URL, "AIRCALL_BRIDGE_BASE_URL"),
        apiKey: env.AIRCALL_BRIDGE_API_KEY,
      };
    case "8x8":
      return {
        baseUrl: requireBridgeBaseUrl(env.EIGHT_BY_EIGHT_BRIDGE_BASE_URL, "EIGHT_BY_EIGHT_BRIDGE_BASE_URL"),
        apiKey: env.EIGHT_BY_EIGHT_BRIDGE_API_KEY,
      };
    case "ooma_office":
      return {
        baseUrl: requireBridgeBaseUrl(env.OOMA_OFFICE_BRIDGE_BASE_URL, "OOMA_OFFICE_BRIDGE_BASE_URL"),
        apiKey: env.OOMA_OFFICE_BRIDGE_API_KEY,
      };
    case "microsoft_teams_phone":
      return {
        baseUrl: requireBridgeBaseUrl(
          env.MICROSOFT_TEAMS_PHONE_BRIDGE_BASE_URL,
          "MICROSOFT_TEAMS_PHONE_BRIDGE_BASE_URL",
        ),
        apiKey: env.MICROSOFT_TEAMS_PHONE_BRIDGE_API_KEY,
      };
    case "custom_integration":
      return {
        baseUrl: requireBridgeBaseUrl(
          env.CUSTOM_INTEGRATION_BRIDGE_BASE_URL,
          "CUSTOM_INTEGRATION_BRIDGE_BASE_URL",
        ),
        apiKey: env.CUSTOM_INTEGRATION_BRIDGE_API_KEY,
      };
    default:
      return null;
  }
}

function requireWhatsAppAuth(): { accessToken: string; phoneNumberId: string } {
  if (!env.WHATSAPP_ACCESS_TOKEN?.trim() || !env.WHATSAPP_PHONE_NUMBER_ID?.trim()) {
    throw new Error("WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are required for WhatsApp");
  }
  return {
    accessToken: env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
  };
}

function requireVonageAuth(): {
  apiKey: string;
  apiSecret: string;
  applicationId: string;
  privateKey: string;
  brandName?: string;
  webhookSignatureSecret?: string;
} {
  if (
    !env.VONAGE_API_KEY?.trim() ||
    !env.VONAGE_API_SECRET?.trim() ||
    !env.VONAGE_APPLICATION_ID?.trim() ||
    !env.VONAGE_PRIVATE_KEY?.trim()
  ) {
    throw new Error(
      "VONAGE_API_KEY, VONAGE_API_SECRET, VONAGE_APPLICATION_ID, and VONAGE_PRIVATE_KEY are required for Vonage",
    );
  }
  return {
    apiKey: env.VONAGE_API_KEY,
    apiSecret: env.VONAGE_API_SECRET,
    applicationId: env.VONAGE_APPLICATION_ID,
    privateKey: env.VONAGE_PRIVATE_KEY,
    brandName: env.VONAGE_BRAND_NAME,
    webhookSignatureSecret: env.VONAGE_WEBHOOK_SIGNATURE_SECRET,
  };
}

function ensureProviderReady(
  providerId: IntegrationProviderId,
  capability: IntegrationCapability,
): IntegrationProviderId {
  const entry = getIntegrationCatalogEntry(providerId);
  if (entry.adapterStatus !== "live") {
    throw new Error(
      `Integration "${providerId}" is not runtime-enabled yet (status: ${entry.adapterStatus})`,
    );
  }
  if (!entry.capabilities.includes(capability)) {
    throw new Error(`Integration "${providerId}" does not support ${capability}`);
  }
  return providerId;
}

export function getDialProvider(preferredRaw: string): DialProvider {
  if (env.DEMO_MODE && !env.DEMO_USE_BRIDGE) return createDemoDialProvider();
  const preferred = ensureProviderReady(coerceIntegrationProviderId(preferredRaw), "voice");
  switch (preferred) {
    case "twilio":
      return createTwilioDialProvider(twilioAuth());
    case "google_voice":
    case "callhippo":
    case "ringcentral":
    case "nextiva":
    case "dialpad":
    case "zoom_phone":
    case "aircall":
    case "8x8":
    case "ooma_office":
    case "microsoft_teams_phone":
    case "custom_integration": {
      const bridge = bridgeConfig(preferred);
      if (!bridge) throw new Error(`Bridge provider "${preferred}" is not configured`);
      return createHttpBridgeDialProvider({
        provider: preferred,
        bridgeBaseUrl: bridge.baseUrl,
        apiKey: bridge.apiKey,
      });
    }
    case "vonage":
      return createVonageDialProvider(requireVonageAuth());
    case "whatsapp":
    case "salesforce":
    case "zoho":
    case "hubspot":
    case "pipedrive":
    case "freshsales":
    case "zendesk_sell":
      throw new Error(`Dial provider "${preferred}" is not configured for voice calls`);
  }
}

export function getSmsProvider(preferredRaw: string): SmsProvider {
  if (env.DEMO_MODE && !env.DEMO_USE_BRIDGE) return createDemoSmsProvider();
  const preferredCapability = preferredRaw === "whatsapp" ? "messaging" : "sms";
  const preferred = ensureProviderReady(
    coerceIntegrationProviderId(preferredRaw),
    preferredCapability,
  );
  switch (preferred) {
    case "twilio":
      return createTwilioSmsProvider(twilioAuth());
    case "google_voice":
    case "callhippo":
    case "ringcentral":
    case "nextiva":
    case "dialpad":
    case "zoom_phone":
    case "aircall":
    case "8x8":
    case "ooma_office":
    case "microsoft_teams_phone":
    case "custom_integration": {
      const bridge = bridgeConfig(preferred);
      if (!bridge) throw new Error(`Bridge provider "${preferred}" is not configured`);
      return createHttpBridgeSmsProvider({
        provider: preferred,
        bridgeBaseUrl: bridge.baseUrl,
        apiKey: bridge.apiKey,
      });
    }
    case "whatsapp":
      return createWhatsAppCloudSmsProvider(requireWhatsAppAuth());
    case "vonage":
      return createVonageSmsProvider(requireVonageAuth());
    case "salesforce":
    case "zoho":
    case "hubspot":
    case "pipedrive":
    case "freshsales":
    case "zendesk_sell":
      throw new Error(`SMS provider "${preferred}" is not configured for messaging`);
  }
}

export function getTwilioWebhookProviders():
  | { dialProvider: DialProvider; smsProvider: SmsProvider }
  | null {
  if (env.DEMO_MODE) {
    return { dialProvider: createDemoDialProvider(), smsProvider: createDemoSmsProvider() };
  }
  if (!env.TWILIO_ACCOUNT_SID?.trim() || !env.TWILIO_AUTH_TOKEN?.trim()) return null;
  const auth = twilioAuth();
  return {
    dialProvider: createTwilioDialProvider(auth),
    smsProvider: createTwilioSmsProvider(auth),
  };
}

export function getVonageWebhookProviders():
  | { dialProvider: DialProvider; smsProvider: SmsProvider }
  | null {
  if (env.DEMO_MODE) {
    return { dialProvider: createDemoDialProvider(), smsProvider: createDemoSmsProvider() };
  }
  if (
    !env.VONAGE_API_KEY?.trim() ||
    !env.VONAGE_API_SECRET?.trim() ||
    !env.VONAGE_APPLICATION_ID?.trim() ||
    !env.VONAGE_PRIVATE_KEY?.trim()
  ) {
    return null;
  }
  const auth = requireVonageAuth();
  return {
    dialProvider: createVonageDialProvider(auth),
    smsProvider: createVonageSmsProvider(auth),
  };
}

export async function getPreferredIntegrationKey(
  readPreference: () => Promise<{ preferredIntegrationKey: string } | null>,
): Promise<IntegrationProviderId> {
  const row = await readPreference();
  return resolveIntegrationProviderId(row?.preferredIntegrationKey ?? "") ?? "twilio";
}
