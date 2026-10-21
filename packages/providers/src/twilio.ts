import twilio from "twilio";
import {
  normalizeTwilioCallStatus,
  normalizeTwilioSmsStatus,
} from "@powerdialer/shared";
import type {
  DialProvider,
  NormalizedSmsWebhook,
  NormalizedVoiceWebhook,
  PlaceCallInput,
  PlaceCallResult,
  SendSmsInput,
  SendSmsResult,
  SmsProvider,
} from "./types.js";

function escapeXml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function buildSayTwiml(message: string): string {
  const safe = escapeXml(message.slice(0, 500));
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna">${safe}</Say></Response>`;
}

export function createTwilioDialProvider(opts: {
  accountSid: string;
  authToken: string;
}): DialProvider {
  const client = twilio(opts.accountSid, opts.authToken);

  return {
    async placeCall(input: PlaceCallInput): Promise<PlaceCallResult> {
      try {
        const call = await client.calls.create({
          to: input.toE164,
          from: input.fromE164,
          ...(input.twimlUrl ? { url: input.twimlUrl, method: "POST" as const } : { twiml: buildSayTwiml(input.voiceMessage) }),
          statusCallback: input.statusCallbackUrl,
          statusCallbackEvent: [
            "initiated",
            "ringing",
            "answered",
            "completed",
          ],
          statusCallbackMethod: "POST",
          ...(input.voicemailDropEnabled ? { machineDetection: "DetectMessageEnd" as const } : {}),
        });
        return { ok: true, externalCallId: call.sid };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, error: msg };
      }
    },

    parseVoiceWebhook(
      body: Record<string, string>,
      signature: string | undefined,
      url: string,
    ): NormalizedVoiceWebhook | { error: string } {
      const valid = twilio.validateRequest(
        opts.authToken,
        signature ?? "",
        url,
        body,
      );
      if (!valid) return { error: "Invalid Twilio signature" };

      const externalCallId = body.CallSid ?? "";
      if (!externalCallId) return { error: "Missing CallSid" };

      const disposition = normalizeTwilioCallStatus(
        body.CallStatus,
        body.AnsweredBy,
      );
      return { externalCallId, disposition, raw: body };
    },
  };
}

export function createTwilioSmsProvider(opts: {
  accountSid: string;
  authToken: string;
}): SmsProvider {
  const client = twilio(opts.accountSid, opts.authToken);

  return {
    async sendSms(input: SendSmsInput): Promise<SendSmsResult> {
      try {
        const msg = await client.messages.create({
          to: input.toE164,
          from: input.fromE164,
          body: input.body,
          statusCallback: input.statusCallbackUrl,
        });
        return { ok: true, externalMessageId: msg.sid };
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        return { ok: false, error: err };
      }
    },

    parseSmsWebhook(
      body: Record<string, string>,
      signature: string | undefined,
      url: string,
    ): NormalizedSmsWebhook | { error: string } {
      const valid = twilio.validateRequest(
        opts.authToken,
        signature ?? "",
        url,
        body,
      );
      if (!valid) return { error: "Invalid Twilio signature" };

      const externalMessageId = body.MessageSid ?? body.SmsSid ?? "";
      if (!externalMessageId) return { error: "Missing MessageSid" };

      const status = normalizeTwilioSmsStatus(body.MessageStatus ?? body.SmsStatus);
      return { externalMessageId, status, raw: body };
    },
  };
}
