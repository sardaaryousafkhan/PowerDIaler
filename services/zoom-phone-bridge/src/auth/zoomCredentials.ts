import { z } from "zod";
import { env } from "../env.js";

/** Per-tenant Zoom Server-to-Server OAuth + Phone defaults (from DashDialer org secrets). */
export const zoomCredentialsSchema = z.object({
  accountId: z.string().min(1),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  defaultUserId: z.string().min(1).optional(),
  callerId: z.string().min(8).optional(),
});

export type ZoomCredentials = z.infer<typeof zoomCredentialsSchema>;

/** Resolve request credentials, falling back to bridge .env for single-tenant demos. */
export function resolveZoomCredentials(
  fromRequest: ZoomCredentials | null | undefined,
): ZoomCredentials | null {
  if (fromRequest?.accountId && fromRequest.clientId && fromRequest.clientSecret) {
    return {
      accountId: fromRequest.accountId.trim(),
      clientId: fromRequest.clientId.trim(),
      clientSecret: fromRequest.clientSecret.trim(),
      defaultUserId: fromRequest.defaultUserId?.trim() || undefined,
      callerId: fromRequest.callerId?.trim() || undefined,
    };
  }
  const accountId = env.ZOOM_ACCOUNT_ID?.trim();
  const clientId = env.ZOOM_CLIENT_ID?.trim();
  const clientSecret = env.ZOOM_CLIENT_SECRET?.trim();
  if (!accountId || !clientId || !clientSecret) return null;
  return {
    accountId,
    clientId,
    clientSecret,
    defaultUserId: env.ZOOM_DEFAULT_USER_ID?.trim() || undefined,
    callerId: env.ZOOM_PHONE_CALLER_ID?.trim() || undefined,
  };
}
