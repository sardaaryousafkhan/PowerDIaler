import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../env.js";

export function verifyBridgeCallbackSignature(rawBody: string, signature: string | undefined): boolean {
  const secret = env.BRIDGE_CALLBACK_SECRET?.trim();
  if (!secret) return false;
  if (!signature?.trim()) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature.trim());
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
