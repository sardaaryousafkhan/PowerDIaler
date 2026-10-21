import type { SendSmsInput, SendSmsResult, SmsProvider } from "./types.js";

type WhatsAppSendResponse = {
  messages?: Array<{ id?: string }>;
  error?: { message?: string };
};

function stripPlus(e164: string): string {
  return e164.startsWith("+") ? e164.slice(1) : e164;
}

export function createWhatsAppCloudSmsProvider(opts: {
  accessToken: string;
  phoneNumberId: string;
}): SmsProvider {
  const endpoint = `https://graph.facebook.com/v21.0/${opts.phoneNumberId}/messages`;
  return {
    async sendSms(input: SendSmsInput): Promise<SendSmsResult> {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${opts.accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: stripPlus(input.toE164),
            type: "text",
            text: { body: input.body.slice(0, 4096) },
            biz_opaque_callback_data: input.idempotencyKey.slice(0, 512),
          }),
        });
        const payload = (await res.json().catch(() => ({}))) as WhatsAppSendResponse;
        if (!res.ok) {
          const errMsg = payload.error?.message ?? `WhatsApp API failed (${res.status})`;
          return { ok: false, error: errMsg };
        }
        const externalMessageId = payload.messages?.[0]?.id;
        if (!externalMessageId) {
          return { ok: false, error: "WhatsApp response missing message id" };
        }
        return { ok: true, externalMessageId };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },

    parseSmsWebhook() {
      return { error: "WhatsApp Cloud webhook normalization is not configured on this endpoint" };
    },
  };
}
