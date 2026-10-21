import { createHash } from "node:crypto";
import { env } from "../env.js";
import type { ZoomCredentials } from "./zoomCredentials.js";
import { resolveZoomCredentials } from "./zoomCredentials.js";

type TokenCache = {
  accessToken: string;
  expiresAt: number;
};

/**
 * OAuth token cache per credential set (Account ID + Client ID + secret fingerprint).
 * Same Zoom account with a wrong Client Secret must not reuse another org's token.
 */
const cacheByCreds = new Map<string, TokenCache>();

function cacheKey(creds: ZoomCredentials): string {
  const secretFp = createHash("sha256").update(creds.clientSecret).digest("hex").slice(0, 16);
  return `${creds.accountId}:${creds.clientId}:${secretFp}`;
}

export async function getZoomAccessToken(
  credentials?: ZoomCredentials | null,
): Promise<string | null> {
  if (env.ZOOM_BRIDGE_MODE === "mock") return null;
  const creds = resolveZoomCredentials(credentials ?? null);
  if (!creds) return null;

  const key = cacheKey(creds);
  const hit = cacheByCreds.get(key);
  if (hit && hit.expiresAt > Date.now() + 60_000) {
    return hit.accessToken;
  }

  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");
  const res = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(creds.accountId)}`,
    {
      method: "POST",
      headers: {
        authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );
  if (!res.ok) {
    let errBody = "";
    try {
      errBody = await res.text();
    } catch {
      errBody = "(unreadable)";
    }
    console.error("[bridge:zoom] OAuth token request failed", {
      accountId: creds.accountId,
      status: res.status,
      body: errBody.slice(0, 300),
    });
    return null;
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    console.error("[bridge:zoom] OAuth token response missing access_token");
    return null;
  }
  cacheByCreds.set(key, {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  });
  return data.access_token;
}

export async function zoomAuthStatus(
  credentials?: ZoomCredentials | null,
): Promise<"ok" | "degraded" | "missing"> {
  if (env.ZOOM_BRIDGE_MODE === "mock") return "ok";
  const creds = resolveZoomCredentials(credentials ?? null);
  if (!creds) return "missing";
  const token = await getZoomAccessToken(creds);
  return token ? "ok" : "degraded";
}
