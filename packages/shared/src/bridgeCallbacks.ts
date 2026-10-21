import { z } from "zod";
import { callDispositionSchema, smsStatusSchema } from "./dispositions.js";

export const bridgeCallTypeSchema = z.enum(["agent", "broadcast"]);

export const bridgeProviderSchema = z.enum([
  "zoom_phone",
  "google_voice",
  "callhippo",
  "ringcentral",
  "nextiva",
  "dialpad",
  "aircall",
  "8x8",
  "ooma_office",
  "microsoft_teams_phone",
  "custom_integration",
]);

export const bridgeVoiceCallbackSchema = z.object({
  externalCallId: z.string().min(1),
  disposition: callDispositionSchema,
  provider: bridgeProviderSchema.optional().default("zoom_phone"),
  campaignId: z.string().optional(),
  contactId: z.string().optional(),
  idempotencyKey: z.string().optional(),
  recordingUrl: z.string().url().optional(),
  voicemailDropSupported: z.boolean().optional(),
  raw: z.record(z.unknown()).optional(),
});

export const bridgeSmsCallbackSchema = z.object({
  externalMessageId: z.string().min(1),
  status: smsStatusSchema,
  provider: bridgeProviderSchema.optional().default("zoom_phone"),
  raw: z.record(z.unknown()).optional(),
});

export type BridgeVoiceCallback = z.infer<typeof bridgeVoiceCallbackSchema>;
export type BridgeSmsCallback = z.infer<typeof bridgeSmsCallbackSchema>;
