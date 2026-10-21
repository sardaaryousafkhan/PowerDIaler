import { parsePhoneNumberFromString } from "libphonenumber-js";

const TRANSIENT_PATTERNS = [
  /\btimeout\b/i,
  /\betimedout\b/i,
  /\beconnreset\b/i,
  /\beconnrefused\b/i,
  /\btemporar/i,
  /\brate limit/i,
  /\b429\b/,
  /\b5\d\d\b/,
];

export type ProviderFailureInfo = {
  retryable: boolean;
  errorCode: string;
  rawError: string;
};

export function classifyProviderFailure(error: string): ProviderFailureInfo {
  const rawError = String(error ?? "").trim();
  const codeMatch = /\b([A-Z]{2,8}\d{2,6}|\d{3,6})\b/.exec(rawError);
  const errorCode = codeMatch?.[1] ?? "UNKNOWN";
  const retryable = TRANSIENT_PATTERNS.some((pattern) => pattern.test(rawError));
  return { retryable, errorCode, rawError };
}

export function inferCountryFromE164(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164);
  return parsed?.country ?? "UNKNOWN";
}

export function jitterDelayMs(baseMs: number): number {
  const jitter = Math.floor(Math.random() * 400);
  return baseMs + jitter;
}
