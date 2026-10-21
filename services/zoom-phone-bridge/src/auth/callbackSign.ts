import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../env.js";

export function signCallbackBody(rawBody: string): string {
  return createHmac("sha256", env.BRIDGE_CALLBACK_SECRET).update(rawBody).digest("hex");
}

export function verifyCallbackSignature(rawBody: string, signature: string | undefined): boolean {
  if (!signature?.trim()) return false;
  const expected = signCallbackBody(rawBody);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature.trim());
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
