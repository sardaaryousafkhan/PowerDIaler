import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(5999),
  BRIDGE_API_KEY: z.string().min(8),
  BRIDGE_CALLBACK_SECRET: z.string().min(16),
  ZOOM_ACCOUNT_ID: z.string().optional(),
  ZOOM_CLIENT_ID: z.string().optional(),
  ZOOM_CLIENT_SECRET: z.string().optional(),
  ZOOM_WEBHOOK_SECRET: z.string().optional(),
  ZOOM_DEFAULT_USER_ID: z.string().optional(),
  ZOOM_PHONE_CALLER_ID: z.string().optional(),
  PUBLIC_BRIDGE_URL: z.string().url().default("http://127.0.0.1:5999"),
  POWER_DIALER_PUBLIC_URL: z.string().url().default("http://127.0.0.1:4000"),
  DATABASE_URL: z.string().default("file:./bridge.db"),
  ZOOM_BRIDGE_MODE: z.enum(["mock", "api"]).default("mock"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error(parsed.error.flatten());
  throw new Error("Invalid bridge environment configuration");
}

export const env = parsed.data;
