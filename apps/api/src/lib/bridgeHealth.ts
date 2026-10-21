import { env } from "../env.js";

export type BridgeHealth = {
  ok: boolean;
  zoomAuth?: string;
  googleAuth?: string;
  zoomUserPhoneLicense?: boolean;
  googleVoiceReady?: boolean;
  smsEnabled?: boolean;
  mode?: string;
  provider?: string;
};

type CacheEntry = { at: number; healthy: boolean; body: BridgeHealth | null };

const caches = new Map<string, CacheEntry>();
const TTL_MS = 30_000;

async function fetchHealthFromBridge(
  baseUrl: string | undefined,
  apiKey: string | undefined,
  authOk: (body: BridgeHealth) => boolean,
): Promise<{ healthy: boolean; body: BridgeHealth | null }> {
  const base = baseUrl?.trim();
  if (!base) return { healthy: false, body: null };

  let healthy = false;
  let body: BridgeHealth | null = null;
  try {
    const headers: Record<string, string> = {};
    if (apiKey?.trim()) {
      headers.authorization = `Bearer ${apiKey}`;
      headers["x-api-key"] = apiKey;
    }
    const res = await fetch(`${base.replace(/\/$/, "")}/health`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      body = (await res.json()) as BridgeHealth;
      healthy = Boolean(body.ok && authOk(body));
    }
  } catch {
    healthy = false;
  }
  return { healthy, body };
}

function cachedFetch(
  cacheKey: string,
  loader: () => Promise<{ healthy: boolean; body: BridgeHealth | null }>,
): Promise<{ healthy: boolean; body: BridgeHealth | null }> {
  const now = Date.now();
  const hit = caches.get(cacheKey);
  if (hit && now - hit.at < TTL_MS) {
    return Promise.resolve({ healthy: hit.healthy, body: hit.body });
  }
  return loader().then((result) => {
    caches.set(cacheKey, { at: now, ...result });
    return result;
  });
}

export async function isBridgeHealthy(): Promise<boolean> {
  const { healthy } = await cachedFetch("zoom", () =>
    fetchHealthFromBridge(
      env.ZOOM_PHONE_BRIDGE_BASE_URL,
      env.ZOOM_PHONE_BRIDGE_API_KEY,
      (b) => Boolean(b.ok && (b.zoomAuth === "ok" || b.mode === "mock")),
    ),
  );
  return healthy;
}

export async function fetchBridgeHealth(): Promise<BridgeHealth | null> {
  const { body } = await cachedFetch("zoom", () =>
    fetchHealthFromBridge(
      env.ZOOM_PHONE_BRIDGE_BASE_URL,
      env.ZOOM_PHONE_BRIDGE_API_KEY,
      (b) => Boolean(b.ok && (b.zoomAuth === "ok" || b.mode === "mock")),
    ),
  );
  return body;
}

/**
 * Multi-tenant Zoom health: POST org Marketplace credentials to the shared helper.
 * Does not use the shared GET /health cache (each org must validate its own account).
 */
export async function fetchZoomBridgeHealthForOrg(
  credentials: {
    accountId: string;
    clientId: string;
    clientSecret: string;
    defaultUserId?: string;
    callerId?: string;
  } | null,
): Promise<BridgeHealth | null> {
  const base = env.ZOOM_PHONE_BRIDGE_BASE_URL?.trim();
  if (!base) return null;
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const apiKey = env.ZOOM_PHONE_BRIDGE_API_KEY?.trim();
    if (apiKey) {
      headers.authorization = `Bearer ${apiKey}`;
      headers["x-api-key"] = apiKey;
    }
    const res = await fetch(`${base.replace(/\/$/, "")}/health`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(12_000),
      body: JSON.stringify(credentials ? { zoomCredentials: credentials } : {}),
    });
    if (!res.ok) return null;
    return (await res.json()) as BridgeHealth;
  } catch {
    return null;
  }
}

export async function fetchGoogleVoiceBridgeHealth(): Promise<BridgeHealth | null> {
  const { body } = await cachedFetch("google_voice", () =>
    fetchHealthFromBridge(
      env.GOOGLE_VOICE_BRIDGE_BASE_URL,
      env.GOOGLE_VOICE_BRIDGE_API_KEY,
      (b) =>
        b.googleAuth === "ok" ||
        b.googleAuth === "mock" ||
        b.googleAuth === "hybrid" ||
        Boolean(b.googleVoiceReady),
    ),
  );
  return body;
}
