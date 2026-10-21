import { ccaiBaseUrl, ccaiConfigured, env } from "../env.js";

function basicAuthHeader(): string {
  const user = env.CCAI_SUBDOMAIN!.trim();
  const pass = env.CCAI_API_TOKEN!.trim();
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

type CcaiJson = Record<string, unknown>;

async function ccaiPost(path: string, body: Record<string, unknown>): Promise<CcaiJson> {
  const url = `${ccaiBaseUrl()}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: basicAuthHeader(),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let json: CcaiJson = {};
  try {
    json = text ? (JSON.parse(text) as CcaiJson) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const msg =
      (typeof json.message === "string" && json.message) ||
      (typeof json.error === "string" && json.error) ||
      text ||
      `CCAI request failed (${res.status})`;
    console.error("[google-voice-bridge] CCAI error", { path, status: res.status, body: text.slice(0, 500) });
    throw new Error(msg);
  }
  return json;
}

export function ccaiAuthStatus(): "ok" | "not_configured" | "error" {
  if (!ccaiConfigured()) return "not_configured";
  return "ok";
}

export async function placeCcaiOutboundCall(opts: {
  agentEmail: string;
  toE164: string;
  fromE164?: string;
}): Promise<string> {
  if (!ccaiConfigured()) {
    throw new Error("CCAI credentials not configured");
  }
  const payload: Record<string, unknown> = {
    call_type: "Voice Outbound (API)",
    agent_email: opts.agentEmail,
    end_user_number: opts.toE164,
  };
  if (opts.fromE164?.trim()) {
    payload.outbound_number = opts.fromE164.trim();
  } else if (env.GOOGLE_VOICE_CALLER_ID?.trim()) {
    payload.outbound_number = env.GOOGLE_VOICE_CALLER_ID.trim();
  }

  const json = await ccaiPost("/calls", payload);
  const id =
    String(json.id ?? json.call_id ?? json.session_id ?? json.uuid ?? "").trim() ||
    `ccai-${Date.now()}`;
  return id;
}

export async function sendCcaiSms(opts: {
  toE164: string;
  fromE164: string;
  body: string;
  agentEmail?: string;
}): Promise<string> {
  if (!ccaiConfigured()) {
    throw new Error("CCAI credentials not configured");
  }
  const payload: Record<string, unknown> = {
    chat_type: "Messaging (SMS)",
    end_user_number: opts.toE164,
    outbound_number: opts.fromE164,
    message: opts.body,
  };
  if (opts.agentEmail?.trim()) {
    payload.agent_email = opts.agentEmail.trim();
  }

  const json = await ccaiPost("/sms", payload);
  const id =
    String(json.id ?? json.chat_id ?? json.message_id ?? json.session_id ?? "").trim() ||
    `ccai-sms-${Date.now()}`;
  return id;
}
