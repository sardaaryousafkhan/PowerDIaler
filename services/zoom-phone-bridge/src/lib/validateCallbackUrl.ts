import { env } from "../env.js";

// Hosts that we treat as equivalent for callback validation. Useful in dev where
// POWER_DIALER_PUBLIC_URL might be `http://127.0.0.1:4000` but a script posts via
// `http://localhost:4000` (and vice versa). This does NOT relax production safety:
// the hostnames still must come from this loopback alias set.
const LOOPBACK_ALIASES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function normalizeOrigin(u: URL): string {
  const host = LOOPBACK_ALIASES.has(u.hostname) ? "127.0.0.1" : u.hostname;
  return `${u.protocol}//${host}:${u.port || (u.protocol === "https:" ? "443" : "80")}`;
}

export function isAllowedStatusCallbackUrl(url: string): boolean {
  try {
    const allowed = new URL(env.POWER_DIALER_PUBLIC_URL);
    const target = new URL(url);
    return normalizeOrigin(target) === normalizeOrigin(allowed);
  } catch {
    return false;
  }
}
