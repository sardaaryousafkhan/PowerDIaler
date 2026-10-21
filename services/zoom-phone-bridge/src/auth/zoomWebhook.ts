import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../env.js";

/** Verify Zoom webhook x-zm-signature (v0 format). */
export function verifyZoomWebhookSignature(
  rawBody: string,
  signature: string | undefined,
  timestamp: string | undefined,
): boolean {
  const secret = env.ZOOM_WEBHOOK_SECRET?.trim();
  if (!secret || !signature || !timestamp) return env.ZOOM_BRIDGE_MODE === "mock";
  const message = `v0:${timestamp}:${rawBody}`;
  const hash = createHmac("sha256", secret).update(message).digest("hex");
  const expected = `v0=${hash}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
