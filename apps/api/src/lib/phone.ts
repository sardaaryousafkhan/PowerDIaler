import { parsePhoneNumberFromString } from "libphonenumber-js";

/**
 * Normalize a phone string to E.164 (+country…digits).
 * Accepts:
 *  - already-international: +12025550101
 *  - US 10-digit: 2025550101 / (202) 555-0101
 *  - US with leading 1: 1-202-555-0101
 * Returns null when the number cannot be validated.
 */
export function toE164(input: string, defaultCountry: "US" = "US"): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Prefer an explicit +country form when provided.
  if (trimmed.startsWith("+")) {
    const parsed = parsePhoneNumberFromString(trimmed);
    if (!parsed?.isValid()) return null;
    return parsed.number;
  }

  // Strip common separators so (202) 555-0101 and 202.555.0101 both work.
  const digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return null;

  const candidate =
    digits.length === 10
      ? `+1${digits}`
      : digits.length === 11 && digits.startsWith("1")
        ? `+${digits}`
        : `+${digits}`;

  const parsedPlus = parsePhoneNumberFromString(candidate);
  if (parsedPlus?.isValid()) return parsedPlus.number;

  // Last resort: let libphonenumber infer using a default country.
  const parsedLocal = parsePhoneNumberFromString(trimmed, defaultCountry);
  if (!parsedLocal?.isValid()) return null;
  return parsedLocal.number;
}
