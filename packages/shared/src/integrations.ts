import { z } from "zod";

/** Keys for supported integration targets in this codebase. */
export const INTEGRATION_PROVIDER_IDS = [
  "twilio",
  "vonage",
  "ringcentral",
  "google_voice",
  "nextiva",
  "dialpad",
  "zoom_phone",
  "aircall",
  "8x8",
  "ooma_office",
  "callhippo",
  "whatsapp",
  "microsoft_teams_phone",
  "salesforce",
  "zoho",
  "hubspot",
  "pipedrive",
  "freshsales",
  "zendesk_sell",
  "custom_integration",
] as const;

export type IntegrationProviderId = (typeof INTEGRATION_PROVIDER_IDS)[number];

const INTEGRATION_ID_SET = new Set<string>(INTEGRATION_PROVIDER_IDS);

/** Maps any stored string to a known provider id (defaults to Twilio). */
export function coerceIntegrationProviderId(raw: string): IntegrationProviderId {
  return INTEGRATION_ID_SET.has(raw) ? (raw as IntegrationProviderId) : "twilio";
}

/** Resolves raw provider ids without fallback; returns null for unknown values. */
export function resolveIntegrationProviderId(raw: string): IntegrationProviderId | null {
  return INTEGRATION_ID_SET.has(raw) ? (raw as IntegrationProviderId) : null;
}

export const integrationProviderIdSchema = z.enum(INTEGRATION_PROVIDER_IDS);

/** Hard ceiling for outbound SMS queue pacing (messages per minute). */
/** Hard ceiling for queued texts per minute (providers may throttle below this). */
export const SMS_PER_MINUTE_MAX = 120;
export const SMS_PER_MINUTE_DEFAULT = 60;

export const smsPerMinuteSchema = z.coerce
  .number()
  .int()
  .min(1, "SMS rate must be at least 1 per minute")
  .max(SMS_PER_MINUTE_MAX, `SMS rate cannot exceed ${SMS_PER_MINUTE_MAX} per minute`);

/** Convert a per-minute rate into job spacing (ms) between queued SMS. */
export function smsDelayMsForRate(perMinute: number): number {
  const rate = Math.min(SMS_PER_MINUTE_MAX, Math.max(1, Math.floor(perMinute)));
  return Math.ceil(60_000 / rate);
}

export const integrationPreferencePatchSchema = z
  .object({
    preferredIntegrationKey: integrationProviderIdSchema.optional(),
    smsPerMinute: smsPerMinuteSchema.optional(),
  })
  .refine(
    (value) => value.preferredIntegrationKey !== undefined || value.smsPerMinute !== undefined,
    { message: "Provide preferredIntegrationKey and/or smsPerMinute" },
  );

export type IntegrationPreferencePatch = z.infer<typeof integrationPreferencePatchSchema>;

export type IntegrationAdapterStatus = "live" | "open_connector";

export type IntegrationCapability = "voice" | "sms" | "messaging" | "teams" | "crm";

export type IntegrationCatalogEntry = {
  id: IntegrationProviderId;
  name: string;
  tagline: string;
  category: string;
  capabilities: IntegrationCapability[];
  websiteUrl: string;
  adapterStatus: IntegrationAdapterStatus;
};

export const integrationsCatalog: IntegrationCatalogEntry[] = [
  {
    id: "twilio",
    name: "Twilio",
    tagline: "Programmable Voice and Messaging — powers live calls and SMS in this app today.",
    category: "Communications platform (CPaaS)",
    capabilities: ["voice", "sms"],
    websiteUrl: "https://www.twilio.com/",
    adapterStatus: "live",
  },
  {
    id: "vonage",
    name: "Vonage",
    tagline: "Voice, SMS, and Video APIs (Nexmo lineage) for global reach.",
    category: "CPaaS / UCaaS",
    capabilities: ["voice", "sms"],
    websiteUrl: "https://www.vonage.com/",
    adapterStatus: "live",
  },
  {
    id: "ringcentral",
    name: "RingCentral",
    tagline: "Cloud business phone and contact center APIs for global teams.",
    category: "UCaaS / CCaaS",
    capabilities: ["voice", "sms"],
    websiteUrl: "https://www.ringcentral.com/",
    adapterStatus: "live",
  },
  {
    id: "google_voice",
    name: "Google Voice",
    tagline: "Consumer and Workspace-linked numbers for calling and voicemail workflows.",
    category: "Consumer / Workspace telephony",
    capabilities: ["voice", "sms"],
    websiteUrl: "https://voice.google.com/",
    adapterStatus: "live",
  },
  {
    id: "nextiva",
    name: "Nextiva",
    tagline: "Business VoIP, contact center, and team collaboration.",
    category: "UCaaS / CCaaS",
    capabilities: ["voice", "sms"],
    websiteUrl: "https://www.nextiva.com/",
    adapterStatus: "live",
  },
  {
    id: "dialpad",
    name: "Dialpad",
    tagline: "AI-powered business phone, meetings, and contact center.",
    category: "UCaaS / CCaaS",
    capabilities: ["voice", "sms", "teams"],
    websiteUrl: "https://www.dialpad.com/",
    adapterStatus: "live",
  },
  {
    id: "zoom_phone",
    name: "Zoom Phone",
    tagline: "Progressive auto-dial via the Zoom Phone bridge, or manual dial in the Zoom app when the bridge is offline.",
    category: "UCaaS",
    capabilities: ["voice", "sms"],
    websiteUrl: "https://www.zoom.com/products/zoom-phone/",
    adapterStatus: "live",
  },
  {
    id: "aircall",
    name: "Aircall",
    tagline: "Cloud call center and phone system for support and sales teams.",
    category: "CCaaS",
    capabilities: ["voice", "sms"],
    websiteUrl: "https://aircall.io/",
    adapterStatus: "live",
  },
  {
    id: "8x8",
    name: "8x8",
    tagline: "XCaaS — voice, video, chat, and contact center in one stack.",
    category: "UCaaS / CCaaS",
    capabilities: ["voice", "sms", "teams"],
    websiteUrl: "https://www.8x8.com/",
    adapterStatus: "live",
  },
  {
    id: "ooma_office",
    name: "Ooma Office",
    tagline: "Small-business phone service with desk phones and mobile apps.",
    category: "UCaaS",
    capabilities: ["voice", "sms"],
    websiteUrl: "https://www.ooma.com/office/",
    adapterStatus: "live",
  },
  {
    id: "callhippo",
    name: "CallHippo",
    tagline: "Virtual business phone numbers and lightweight call center.",
    category: "CCaaS",
    capabilities: ["voice", "sms"],
    websiteUrl: "https://callhippo.com/",
    adapterStatus: "live",
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    tagline: "Session-based messaging for opted-in customers (via BSP / Cloud API patterns).",
    category: "Messaging",
    capabilities: ["messaging"],
    websiteUrl: "https://www.whatsapp.com/business/",
    adapterStatus: "live",
  },
  {
    id: "microsoft_teams_phone",
    name: "Microsoft Teams Phone",
    tagline: "Operator Connect / Direct Routing for PSTN calling inside Teams.",
    category: "UCaaS / Microsoft 365",
    capabilities: ["voice", "teams"],
    websiteUrl: "https://www.microsoft.com/microsoft-teams/microsoft-teams-phone",
    adapterStatus: "live",
  },
  {
    id: "salesforce",
    name: "Salesforce",
    tagline: "CRM sync for leads, activities, call outcomes, and automation handoffs.",
    category: "CRM",
    capabilities: ["crm"],
    websiteUrl: "https://www.salesforce.com/",
    adapterStatus: "open_connector",
  },
  {
    id: "zoho",
    name: "Zoho CRM",
    tagline: "CRM workflows and pipeline sync for calling and messaging teams.",
    category: "CRM",
    capabilities: ["crm"],
    websiteUrl: "https://www.zoho.com/crm/",
    adapterStatus: "open_connector",
  },
  {
    id: "hubspot",
    name: "HubSpot",
    tagline: "Contact, lifecycle, and engagement sync for sales dial workflows.",
    category: "CRM",
    capabilities: ["crm"],
    websiteUrl: "https://www.hubspot.com/",
    adapterStatus: "open_connector",
  },
  {
    id: "pipedrive",
    name: "Pipedrive",
    tagline: "Deal pipeline and call activity sync for outbound teams.",
    category: "CRM",
    capabilities: ["crm"],
    websiteUrl: "https://www.pipedrive.com/",
    adapterStatus: "open_connector",
  },
  {
    id: "freshsales",
    name: "Freshsales",
    tagline: "CRM integration for contact ownership, tasks, and outcomes.",
    category: "CRM",
    capabilities: ["crm"],
    websiteUrl: "https://www.freshworks.com/crm/",
    adapterStatus: "open_connector",
  },
  {
    id: "zendesk_sell",
    name: "Zendesk Sell",
    tagline: "Sales CRM records and call logging integration.",
    category: "CRM",
    capabilities: ["crm"],
    websiteUrl: "https://www.zendesk.com/sell/",
    adapterStatus: "open_connector",
  },
  {
    id: "custom_integration",
    name: "Custom Integration",
    tagline: "Bring your own provider with webhook and bridge endpoints.",
    category: "Open connector",
    capabilities: ["voice", "sms", "messaging", "crm"],
    websiteUrl: "https://example.com/custom-integration",
    adapterStatus: "live",
  },
];

const CATALOG_BY_ID = new Map<IntegrationProviderId, IntegrationCatalogEntry>(
  integrationsCatalog.map((entry) => [entry.id, entry]),
);

export function getIntegrationCatalogEntry(id: IntegrationProviderId): IntegrationCatalogEntry {
  const entry = CATALOG_BY_ID.get(id);
  if (!entry) {
    throw new Error(`Integration catalog is missing provider "${id}"`);
  }
  return entry;
}
