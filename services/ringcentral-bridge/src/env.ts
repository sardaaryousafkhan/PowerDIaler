import "dotenv/config";
import { z } from "zod";

const schema = z
  .object({
    PORT: z.coerce.number().default(5997),
    BRIDGE_API_KEY: z.string().min(8),
    BRIDGE_CALLBACK_SECRET: z.string().min(16),
    POWER_DIALER_PUBLIC_URL: z.string().url().default("http://127.0.0.1:4000"),
    RINGCENTRAL_BRIDGE_MODE: z.enum(["uri", "mock", "api"]).default("uri"),
    URI_CALL_HOLD_MS: z.coerce.number().default(25_000),
    RC_SERVER_URL: z.string().url().optional(),
    RC_CLIENT_ID: z.string().min(1).optional(),
    RC_CLIENT_SECRET: z.string().min(1).optional(),
    RC_JWT: z.string().min(20).optional(),
    RC_DEFAULT_FROM: z.string().min(8).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.RINGCENTRAL_BRIDGE_MODE !== "api") return;
    for (const key of ["RC_SERVER_URL", "RC_CLIENT_ID", "RC_CLIENT_SECRET", "RC_JWT"] as const) {
      if (!val[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${key} is required when RINGCENTRAL_BRIDGE_MODE=api`,
          path: [key],
        });
      }
    }
  });

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error(parsed.error.flatten());
  throw new Error("Invalid RingCentral bridge environment configuration");
}

export const env = parsed.data;
