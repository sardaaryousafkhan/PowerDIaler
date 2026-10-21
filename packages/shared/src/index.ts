import { z } from "zod";
import type { CallDisposition, SmsStatus } from "./dispositions.js";

export {
  coerceIntegrationProviderId,
  getIntegrationCatalogEntry,
  INTEGRATION_PROVIDER_IDS,
  integrationPreferencePatchSchema,
  integrationProviderIdSchema,
  integrationsCatalog,
  resolveIntegrationProviderId,
  SMS_PER_MINUTE_DEFAULT,
  SMS_PER_MINUTE_MAX,
  smsDelayMsForRate,
  smsPerMinuteSchema,
} from "./integrations.js";
export type {
  IntegrationAdapterStatus,
  IntegrationCapability,
  IntegrationCatalogEntry,
  IntegrationPreferencePatch,
  IntegrationProviderId,
} from "./integrations.js";
export {
  FUNCTION_PERMISSION_KEYS,
  ORG_ROLES,
  PERMISSION_KEY_ALIASES,
  defaultPermissionsForOrgRole,
  functionPermissionKeySchema,
  functionPermissionPatchSchema,
} from "./permissions.js";
export type { FunctionPermissionKey, FunctionPermissionPatch, OrgRolePublic } from "./permissions.js";
export {
  bridgeCallTypeSchema,
  bridgeProviderSchema,
  bridgeSmsCallbackSchema,
  bridgeVoiceCallbackSchema,
} from "./bridgeCallbacks.js";
export type { BridgeSmsCallback, BridgeVoiceCallback } from "./bridgeCallbacks.js";

export const e164Schema = z
  .string()
  .regex(/^\+[1-9]\d{1,14}$/, "Must be E.164 (+countrycode...)");

export const contactImportRowSchema = z.object({
  phone: z.string().min(5),
  name: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type ContactImportRow = z.infer<typeof contactImportRowSchema>;

const campaignConsentBase = z.object({
  name: z.string().min(1),
  fromPhone: e164Schema,
  consentNotes: z.string().min(1),
  consentAttested: z.literal(true),
});

/** Progressive voice dialing + optional SMS template. */
const dialCampaignCreateBaseSchema = campaignConsentBase.extend({
  kind: z.literal("DIAL"),
  voiceMessage: z.string().min(1).max(500),
  voicemailDropEnabled: z.boolean().optional(),
  voicemailMessage: z.string().max(500).optional(),
  voicemailAudioDataUrl: z.string().max(2_000_000).optional(),
  smsTemplate: z.string().max(1600).optional(),
});

export const dialCampaignCreateSchema = dialCampaignCreateBaseSchema.superRefine((value, ctx) => {
  if (value.voicemailDropEnabled && !value.voicemailMessage?.trim() && !value.voicemailAudioDataUrl?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide a voicemail drop message or recorded audio.",
      path: ["voicemailMessage"],
    });
  }
});

/** SMS broadcast / text campaigns (no outbound voice dialer). */
export const smsCampaignCreateSchema = campaignConsentBase.extend({
  kind: z.literal("SMS"),
  smsTemplate: z.string().min(1).max(1600),
});

export const campaignCreateSchema = z.union([dialCampaignCreateSchema, smsCampaignCreateSchema]);

export type CampaignCreateInput = z.infer<typeof campaignCreateSchema>;
export type DialCampaignCreateInput = z.infer<typeof dialCampaignCreateSchema>;
export type SmsCampaignCreateInput = z.infer<typeof smsCampaignCreateSchema>;

export const campaignStatusSchema = z.enum([
  "DRAFT",
  "RUNNING",
  "PAUSED",
  "COMPLETED",
]);

export const contactStatusSchema = z.enum([
  "PENDING",
  "DIALING",
  "DIALED",
  "SKIPPED",
]);

export {
  callDispositionSchema,
  smsStatusSchema,
  type CallDisposition,
  type SmsStatus,
} from "./dispositions.js";

export function normalizeTwilioCallStatus(
  status: string | undefined,
  answeredBy?: string | null,
): CallDisposition {
  const s = (status ?? "").toLowerCase();
  if (s === "queued" || s === "initiated") return "QUEUED";
  if (s === "ringing") return "RINGING";
  if (s === "in-progress" || s === "answered") return "IN_PROGRESS";
  if (s === "completed") {
    if (answeredBy && String(answeredBy).includes("machine")) return "COMPLETED";
    return "COMPLETED";
  }
  if (s === "busy") return "BUSY";
  if (s === "no-answer" || s === "no_answer") return "NO_ANSWER";
  if (s === "failed") return "FAILED";
  if (s === "canceled" || s === "cancelled") return "CANCELED";
  return "UNKNOWN";
}

export function normalizeTwilioSmsStatus(status: string | undefined): SmsStatus {
  const s = (status ?? "").toLowerCase();
  if (s === "queued" || s === "accepted") return "QUEUED";
  if (s === "sent" || s === "sending") return "SENT";
  if (s === "delivered") return "DELIVERED";
  if (s === "failed" || s === "undelivered") return "FAILED";
  return "UNKNOWN";
}
