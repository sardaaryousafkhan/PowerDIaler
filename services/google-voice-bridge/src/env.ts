import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(5998),
  BRIDGE_API_KEY: z.string().min(8),
  BRIDGE_CALLBACK_SECRET: z.string().min(16),
  PUBLIC_BRIDGE_URL: z.string().url().default("http://127.0.0.1:5998"),
  POWER_DIALER_PUBLIC_URL: z.string().url().default("http://127.0.0.1:4000"),
  DATABASE_URL: z.string().default("file:./bridge.db"),
  GOOGLE_VOICE_BRIDGE_MODE: z.enum(["mock", "hybrid", "ccai"]).default("mock"),
  /** CCAI Platform subdomain (Basic auth username). */
  CCAI_SUBDOMAIN: z.string().optional(),
  /** CCAI Platform host suffix, e.g. uc1.ccaiplatform.com */
  CCAI_DOMAIN: z.string().optional(),
  /** CCAI API token (Basic auth password). */
  CCAI_API_TOKEN: z.string().optional(),
  /** Default agent email for CCAI outbound when dial body omits agentZoomUserId. */
  CCAI_DEFAULT_AGENT_EMAIL: z.string().email().optional(),
  /** Default outbound caller ID for CCAI (E.164). */
  GOOGLE_VOICE_CALLER_ID: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error(parsed.error.flatten());
  throw new Error("Invalid Google Voice bridge environment configuration");
}

export const env = parsed.data;

export function ccaiConfigured(): boolean {
  return Boolean(
    env.CCAI_SUBDOMAIN?.trim() &&
      env.CCAI_DOMAIN?.trim() &&
      env.CCAI_API_TOKEN?.trim(),
  );
}

export function ccaiBaseUrl(): string {
  return `https://${env.CCAI_SUBDOMAIN!.trim()}.${env.CCAI_DOMAIN!.trim()}/apps/api/v1`;
}
