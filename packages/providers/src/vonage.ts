import {
  createHash,
  createHmac,
  createSign,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
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

const VONAGE_VOICE_API = "https://api.nexmo.com/v1/calls";
const VONAGE_SMS_API = "https://rest.nexmo.com/sms/json";

function mapVonageCallStatus(status: string | undefined): NormalizedVoiceWebhook["disposition"] {
  const s = String(status ?? "").toLowerCase();
  if (s === "started") return "QUEUED";
  if (s === "ringing") return "RINGING";
  if (s === "answered" || s === "human" || s === "machine") return "IN_PROGRESS";
  if (s === "completed") return "COMPLETED";
  if (s === "busy") return "BUSY";
  if (s === "failed" || s === "rejected") return "FAILED";
  if (s === "timeout" || s === "unanswered") return "NO_ANSWER";
  if (s === "cancelled" || s === "canceled") return "CANCELED";
  return "UNKNOWN";
}

function mapVonageSmsStatus(status: string | undefined): NormalizedSmsWebhook["status"] {
  const s = String(status ?? "").toLowerCase();
  if (s === "accepted" || s === "queued" || s === "submitted") return "QUEUED";
  if (s === "sent" || s === "buffered") return "SENT";
  if (s === "delivered") return "DELIVERED";
  if (s === "failed" || s === "rejected" || s === "expired" || s === "undeliverable") return "FAILED";
  return "UNKNOWN";
}

function withTimeout(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** Private keys pasted into .env files often carry literal "\n" sequences. */
function normalizePrivateKey(raw: string): string {
  return raw.includes("\\n") ? raw.replaceAll("\\n", "\n") : raw;
}

/** RS256 JWT required by the Vonage Voice API (application id + private key). */
function createVonageVoiceJwt(applicationId: string, privateKeyRaw: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      application_id: applicationId,
      iat: now,
      nbf: now - 5,
      exp: now + 15 * 60,
      jti: randomUUID(),
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256")
    .update(signingInput)
    .sign(normalizePrivateKey(privateKeyRaw))
    .toString("base64url");
  return `${signingInput}.${signature}`;
}

const MAX_WEBHOOK_JWT_AGE_SECONDS = 15 * 60;

/**
 * Verifies a Vonage signed webhook: an HS256 JWT in the Authorization header,
 * signed with the account signature secret, whose `payload_hash` claim is the
 * SHA-256 of the request body. Returns null on success, or an error string.
 */
export function verifyVonageSignedWebhook(args: {
  signatureSecret: string;
  authorizationHeader: string | undefined;
  body: Record<string, unknown>;
}): string | null {
  const rawHeader = (args.authorizationHeader ?? "").trim();
  const token = rawHeader.toLowerCase().startsWith("bearer ") ? rawHeader.slice(7).trim() : rawHeader;
  if (!token) return "Missing Vonage webhook JWT";
  const parts = token.split(".");
  if (parts.length !== 3) return "Malformed Vonage webhook JWT";
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

  const expected = createHmac("sha256", args.signatureSecret)
    .update(`${headerPart}.${payloadPart}`)
    .digest("base64url");
  const a = Buffer.from(signaturePart);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return "Invalid Vonage webhook signature";
  }

  let claims: { iat?: number; payload_hash?: string };
  try {
    claims = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as {
      iat?: number;
      payload_hash?: string;
    };
  } catch {
    return "Unreadable Vonage webhook JWT claims";
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.iat === "number" && now - claims.iat > MAX_WEBHOOK_JWT_AGE_SECONDS) {
    return "Expired Vonage webhook JWT";
  }

  if (claims.payload_hash) {
    // Vonage hashes the compact JSON body; JSON.parse -> stringify reproduces it.
    const bodyHash = createHash("sha256").update(JSON.stringify(args.body)).digest("hex");
    if (bodyHash !== claims.payload_hash) {
      return "Vonage webhook payload hash mismatch";
    }
  }

  return null;
}

type NccoAction = Record<string, unknown>;

function buildTalkNcco(message: string): NccoAction[] {
  return [
    {
      action: "talk",
      text: message.slice(0, 1000),
      language: "en-US",
      style: 0,
    },
  ];
}

export function createVonageDialProvider(opts: {
  apiKey: string;
  apiSecret: string;
  applicationId: string;
  privateKey: string;
  webhookSignatureSecret?: string;
}): DialProvider {
  return {
    async placeCall(input: PlaceCallInput): Promise<PlaceCallResult> {
      let jwt: string;
      try {
        jwt = createVonageVoiceJwt(opts.applicationId, opts.privateKey);
      } catch (error) {
        return {
          ok: false,
          error: `Vonage private key is invalid: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      try {
        const res = await fetch(VONAGE_VOICE_API, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${jwt}`,
          },
          signal: withTimeout(10_000),
          body: JSON.stringify({
            to: [{ type: "phone", number: input.toE164.replace(/^\+/, "") }],
            from: { type: "phone", number: input.fromE164.replace(/^\+/, "") },
            ncco: buildTalkNcco(input.voiceMessage),
            event_url: [input.statusCallbackUrl],
            event_method: "POST",
            random_from_number: false,
            ...(input.voicemailDropEnabled
              ? {
                  advanced_machine_detection: {
                    behavior: "continue",
                    mode: "detect_beep",
                    beep_timeout: 45,
                  },
                }
              : {}),
          }),
        });
        const payload = (await res.json().catch(() => ({}))) as {
          uuid?: string;
          error_title?: string;
          title?: string;
          detail?: string;
        };
        if (!res.ok) {
          const detail = payload.detail ?? payload.error_title ?? payload.title;
          return { ok: false, error: detail ?? `Vonage voice failed (${res.status})` };
        }
        if (!payload.uuid) return { ok: false, error: "Vonage voice response missing uuid" };
        return { ok: true, externalCallId: payload.uuid };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    parseVoiceWebhook(
      body: Record<string, string>,
      signature: string | undefined,
    ): NormalizedVoiceWebhook | { error: string } {
      if (opts.webhookSignatureSecret?.trim()) {
        const failure = verifyVonageSignedWebhook({
          signatureSecret: opts.webhookSignatureSecret,
          authorizationHeader: signature,
          body,
        });
        if (failure) return { error: failure };
      }
      const externalCallId = body.uuid ?? body.conversation_uuid ?? "";
      if (!externalCallId) return { error: "Missing Vonage uuid" };
      const disposition = mapVonageCallStatus(body.status);
      return { externalCallId, disposition, raw: body };
    },
  };
}

/**
 * Interrupts an in-progress Vonage call to play a voicemail drop after the
 * answering machine beep (used with advanced_machine_detection "continue").
 */
export async function dropVonageVoicemail(opts: {
  applicationId: string;
  privateKey: string;
  callUuid: string;
  message?: string;
  audioUrl?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  let jwt: string;
  try {
    jwt = createVonageVoiceJwt(opts.applicationId, opts.privateKey);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const ncco: NccoAction[] = opts.audioUrl
    ? [{ action: "stream", streamUrl: [opts.audioUrl] }]
    : buildTalkNcco(opts.message ?? "");
  if (!opts.audioUrl && !opts.message?.trim()) {
    return { ok: false, error: "No voicemail message or audio configured" };
  }
  try {
    const res = await fetch(`${VONAGE_VOICE_API}/${encodeURIComponent(opts.callUuid)}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${jwt}`,
      },
      signal: withTimeout(10_000),
      body: JSON.stringify({ action: "transfer", destination: { type: "ncco", ncco } }),
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { detail?: string; title?: string };
      return {
        ok: false,
        error: payload.detail ?? payload.title ?? `Vonage voicemail drop failed (${res.status})`,
      };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const ALPHANUMERIC_SENDER = /^[A-Za-z][A-Za-z0-9 ]{0,10}$/;

function vonageSmsSender(brandName: string | undefined, fromE164: string): string {
  const brand = brandName?.trim() ?? "";
  // Alphanumeric senders are max 11 chars and unsupported in some countries
  // (e.g. the US); otherwise fall back to the campaign number digits.
  if (brand && ALPHANUMERIC_SENDER.test(brand)) return brand;
  return fromE164.replace(/^\+/, "");
}

export function createVonageSmsProvider(opts: {
  apiKey: string;
  apiSecret: string;
  brandName?: string;
  webhookSignatureSecret?: string;
}): SmsProvider {
  return {
    async sendSms(input: SendSmsInput): Promise<SendSmsResult> {
      try {
        const params = new URLSearchParams({
          api_key: opts.apiKey,
          api_secret: opts.apiSecret,
          to: input.toE164.replace(/^\+/, ""),
          from: vonageSmsSender(opts.brandName, input.fromE164),
          text: input.body,
          type: "unicode",
          ...(input.statusCallbackUrl ? { callback: input.statusCallbackUrl } : {}),
          ...(input.correlationId ? { "client-ref": input.correlationId.slice(0, 40) } : {}),
        });
        const res = await fetch(VONAGE_SMS_API, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          signal: withTimeout(10_000),
          body: params.toString(),
        });
        const payload = (await res.json().catch(() => ({}))) as {
          messages?: Array<{ "message-id"?: string; "error-text"?: string; status?: string }>;
        };
        const msg = payload.messages?.[0];
        if (!res.ok || !msg || msg.status !== "0") {
          return { ok: false, error: msg?.["error-text"] ?? `Vonage SMS failed (${res.status})` };
        }
        if (!msg["message-id"]) return { ok: false, error: "Vonage SMS missing message-id" };
        return { ok: true, externalMessageId: msg["message-id"] };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    parseSmsWebhook(
      body: Record<string, string>,
      signature: string | undefined,
    ): NormalizedSmsWebhook | { error: string } {
      // Delivery receipts for the legacy SMS API arrive as form/query params and
      // are not JWT-signed on all accounts; verify the JWT only when present.
      if (opts.webhookSignatureSecret?.trim() && signature?.trim()) {
        const failure = verifyVonageSignedWebhook({
          signatureSecret: opts.webhookSignatureSecret,
          authorizationHeader: signature,
          body,
        });
        if (failure) return { error: failure };
      }
      const externalMessageId = body.messageId ?? body["message-id"] ?? "";
      if (!externalMessageId) return { error: "Missing Vonage message id" };
      const status = mapVonageSmsStatus(body.status);
      return { externalMessageId, status, raw: body };
    },
  };
}
