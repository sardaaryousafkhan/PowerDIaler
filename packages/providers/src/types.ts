import type { CallDisposition, SmsStatus } from "@powerdialer/shared";

/** Zoom Server-to-Server OAuth + Phone defaults passed to the shared bridge. */
export type ZoomBridgeCredentials = {
  accountId: string;
  clientId: string;
  clientSecret: string;
  defaultUserId?: string;
  callerId?: string;
};

export type PlaceCallInput = {
  toE164: string;
  fromE164: string;
  campaignId: string;
  contactId: string;
  statusCallbackUrl: string;
  twimlUrl?: string;
  voiceInstructionsUrl?: string;
  /** TwiML <Say> text or short bridge instruction */
  voiceMessage: string;
  voicemailDropEnabled?: boolean;
  voicemailMessage?: string;
  voicemailAudioUrl?: string;
  voicemailAudioMimeType?: string;
  idempotencyKey: string;
  /** Zoom Phone user id for attended transfer after answer */
  agentZoomUserId?: string;
  callType?: "agent" | "broadcast";
  correlationId?: string;
  /** Per-org Zoom Marketplace credentials (multi-tenant bridge). */
  zoomCredentials?: ZoomBridgeCredentials;
};

export type PlaceCallResult =
  | { ok: true; externalCallId: string }
  | { ok: false; error: string };

export type SendSmsInput = {
  toE164: string;
  fromE164: string;
  body: string;
  idempotencyKey: string;
  statusCallbackUrl?: string;
  correlationId?: string;
  zoomCredentials?: ZoomBridgeCredentials;
};

export type SendSmsResult =
  | { ok: true; externalMessageId: string }
  | { ok: false; error: string };

export type NormalizedVoiceWebhook = {
  externalCallId: string;
  disposition: CallDisposition;
  raw: Record<string, string>;
};

export type NormalizedSmsWebhook = {
  externalMessageId: string;
  status: SmsStatus;
  raw: Record<string, string>;
};

export interface DialProvider {
  placeCall(input: PlaceCallInput): Promise<PlaceCallResult>;
  parseVoiceWebhook(
    body: Record<string, string>,
    signature: string | undefined,
    url: string,
  ): NormalizedVoiceWebhook | { error: string };
}

export interface SmsProvider {
  sendSms(input: SendSmsInput): Promise<SendSmsResult>;
  parseSmsWebhook(
    body: Record<string, string>,
    signature: string | undefined,
    url: string,
  ): NormalizedSmsWebhook | { error: string };
}
