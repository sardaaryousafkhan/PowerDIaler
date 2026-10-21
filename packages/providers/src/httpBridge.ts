import type {
  DialProvider,
  PlaceCallInput,
  PlaceCallResult,
  SendSmsInput,
  SendSmsResult,
  SmsProvider,
} from "./types.js";

type BridgeDialResponse = {
  externalCallId?: string;
  error?: string;
};

type BridgeSmsResponse = {
  externalMessageId?: string;
  error?: string;
};

type BridgeProviderId =
  | "google_voice"
  | "callhippo"
  | "ringcentral"
  | "nextiva"
  | "dialpad"
  | "zoom_phone"
  | "aircall"
  | "8x8"
  | "ooma_office"
  | "microsoft_teams_phone"
  | "custom_integration";

function cleanBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, "");
}

export function createHttpBridgeDialProvider(opts: {
  bridgeBaseUrl: string;
  provider: BridgeProviderId;
  apiKey?: string;
}): DialProvider {
  const base = cleanBaseUrl(opts.bridgeBaseUrl);
  const endpoint = `${base}/dial`;

  return {
    async placeCall(input: PlaceCallInput): Promise<PlaceCallResult> {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(opts.apiKey
              ? { authorization: `Bearer ${opts.apiKey}`, "x-api-key": opts.apiKey }
              : {}),
          },
          signal: AbortSignal.timeout(12_000),
          body: JSON.stringify({
            provider: opts.provider,
            toE164: input.toE164,
            fromE164: input.fromE164,
            campaignId: input.campaignId,
            contactId: input.contactId,
            voiceMessage: input.voiceMessage,
            twimlUrl: input.twimlUrl,
            voiceInstructionsUrl: input.voiceInstructionsUrl,
            voicemailDropEnabled: input.voicemailDropEnabled,
            voicemailMessage: input.voicemailMessage,
            voicemailAudioUrl: input.voicemailAudioUrl,
            voicemailAudioMimeType: input.voicemailAudioMimeType,
            idempotencyKey: input.idempotencyKey,
            statusCallbackUrl: input.statusCallbackUrl,
            agentZoomUserId: input.agentZoomUserId,
            callType: input.callType,
            correlationId: input.correlationId,
            ...(input.zoomCredentials ? { zoomCredentials: input.zoomCredentials } : {}),
          }),
        });
        const payload = (await res.json().catch(() => ({}))) as BridgeDialResponse;
        if (!res.ok) {
          return { ok: false, error: payload.error ?? `Bridge call failed (${res.status})` };
        }
        if (!payload.externalCallId) {
          return { ok: false, error: "Bridge response missing externalCallId" };
        }
        return { ok: true, externalCallId: payload.externalCallId };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },

    parseVoiceWebhook() {
      return { error: "Use your bridge webhook endpoint for this provider" };
    },
  };
}

export function createHttpBridgeSmsProvider(opts: {
  bridgeBaseUrl: string;
  provider: BridgeProviderId;
  apiKey?: string;
}): SmsProvider {
  const base = cleanBaseUrl(opts.bridgeBaseUrl);
  const endpoint = `${base}/sms`;

  return {
    async sendSms(input: SendSmsInput): Promise<SendSmsResult> {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(opts.apiKey
              ? { authorization: `Bearer ${opts.apiKey}`, "x-api-key": opts.apiKey }
              : {}),
          },
          signal: AbortSignal.timeout(12_000),
          body: JSON.stringify({
            provider: opts.provider,
            toE164: input.toE164,
            fromE164: input.fromE164,
            body: input.body,
            idempotencyKey: input.idempotencyKey,
            statusCallbackUrl: input.statusCallbackUrl,
            correlationId: input.correlationId,
            ...(input.zoomCredentials ? { zoomCredentials: input.zoomCredentials } : {}),
          }),
        });
        const payload = (await res.json().catch(() => ({}))) as BridgeSmsResponse;
        if (!res.ok) {
          return { ok: false, error: payload.error ?? `Bridge SMS failed (${res.status})` };
        }
        if (!payload.externalMessageId) {
          return { ok: false, error: "Bridge response missing externalMessageId" };
        }
        return { ok: true, externalMessageId: payload.externalMessageId };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },

    parseSmsWebhook() {
      return { error: "Use your bridge webhook endpoint for this provider" };
    },
  };
}
