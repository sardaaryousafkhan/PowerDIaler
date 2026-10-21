import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { env, type Env } from "../env.js";

/**
 * The Integrations page saves provider credentials to the API's .env file at
 * runtime. The worker is a separate process, so it periodically re-reads that
 * file to pick up credential changes without a restart.
 */
const RELOADABLE_KEYS: Array<keyof Env> = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "VONAGE_API_KEY",
  "VONAGE_API_SECRET",
  "VONAGE_APPLICATION_ID",
  "VONAGE_PRIVATE_KEY",
  "VONAGE_BRAND_NAME",
  "VONAGE_WEBHOOK_SIGNATURE_SECRET",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "GOOGLE_VOICE_BRIDGE_BASE_URL",
  "GOOGLE_VOICE_BRIDGE_API_KEY",
  "CALLHIPPO_BRIDGE_BASE_URL",
  "CALLHIPPO_BRIDGE_API_KEY",
  "RINGCENTRAL_BRIDGE_BASE_URL",
  "RINGCENTRAL_BRIDGE_API_KEY",
  "NEXTIVA_BRIDGE_BASE_URL",
  "NEXTIVA_BRIDGE_API_KEY",
  "DIALPAD_BRIDGE_BASE_URL",
  "DIALPAD_BRIDGE_API_KEY",
  "ZOOM_PHONE_BRIDGE_BASE_URL",
  "ZOOM_PHONE_BRIDGE_API_KEY",
  "BRIDGE_CALLBACK_SECRET",
  "ZOOM_PHONE_AGENT_USER_ID",
  "AIRCALL_BRIDGE_BASE_URL",
  "AIRCALL_BRIDGE_API_KEY",
  "EIGHT_BY_EIGHT_BRIDGE_BASE_URL",
  "EIGHT_BY_EIGHT_BRIDGE_API_KEY",
  "OOMA_OFFICE_BRIDGE_BASE_URL",
  "OOMA_OFFICE_BRIDGE_API_KEY",
  "MICROSOFT_TEAMS_PHONE_BRIDGE_BASE_URL",
  "MICROSOFT_TEAMS_PHONE_BRIDGE_API_KEY",
  "CUSTOM_INTEGRATION_BRIDGE_BASE_URL",
  "CUSTOM_INTEGRATION_BRIDGE_API_KEY",
];

function envFilePath(): string {
  return fileURLToPath(new URL("../../.env", import.meta.url));
}

export async function reloadProviderCredentialsFromDisk(): Promise<void> {
  let raw: string;
  try {
    raw = await fs.readFile(envFilePath(), "utf8");
  } catch {
    return;
  }
  const values = dotenv.parse(raw);
  for (const key of RELOADABLE_KEYS) {
    const next = values[String(key)];
    if (typeof next === "string" && next.trim() && env[key] !== next) {
      (env as Record<string, unknown>)[key as string] = next;
    }
  }
}

export function startProviderCredentialRefresh(intervalMs = 30_000): NodeJS.Timeout {
  const timer = setInterval(() => {
    void reloadProviderCredentialsFromDisk().catch(() => {});
  }, intervalMs);
  timer.unref();
  return timer;
}
