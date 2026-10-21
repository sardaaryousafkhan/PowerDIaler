import { env } from "./env.js";

type TokenCache = {
  accessToken: string;
  expiresAtMs: number;
};

let tokenCache: TokenCache | null = null;

function requireApiConfig(): {
  serverUrl: string;
  clientId: string;
  clientSecret: string;
  jwt: string;
} {
  const serverUrl = env.RC_SERVER_URL?.replace(/\/$/, "");
  const clientId = env.RC_CLIENT_ID;
  const clientSecret = env.RC_CLIENT_SECRET;
  const jwt = env.RC_JWT;
  if (!serverUrl || !clientId || !clientSecret || !jwt) {
    throw new Error(
      "API mode requires RC_SERVER_URL, RC_CLIENT_ID, RC_CLIENT_SECRET, and RC_JWT",
    );
  }
  return { serverUrl, clientId, clientSecret, jwt };
}

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAtMs > now + 60_000) {
    return tokenCache.accessToken;
  }
  const { serverUrl, clientId, clientSecret, jwt } = requireApiConfig();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  });
  const res = await fetch(`${serverUrl}/restapi/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    message?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(
      `RingCentral token failed (${res.status}): ${json.error ?? json.message ?? "unknown"}`,
    );
  }
  tokenCache = {
    accessToken: json.access_token,
    expiresAtMs: now + (json.expires_in ?? 3600) * 1000,
  };
  return json.access_token;
}

async function rcFetch<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { serverUrl } = requireApiConfig();
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`${serverUrl}${path}`, {
    ...init,
    headers,
    body,
    signal: init.signal ?? AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }
  }
  if (!res.ok) {
    const errObj = parsed as { message?: string; errorCode?: string } | null;
    throw new Error(
      `RingCentral ${init.method ?? "GET"} ${path} failed (${res.status}): ${
        errObj?.message ?? errObj?.errorCode ?? text.slice(0, 200)
      }`,
    );
  }
  return parsed as T;
}

export type RingOutResult = {
  id: string;
  status?: { callStatus?: string; callerStatus?: string; calleeStatus?: string };
};

export async function createRingOut(input: {
  fromE164: string;
  toE164: string;
}): Promise<RingOutResult> {
  return rcFetch<RingOutResult>("/restapi/v1.0/account/~/extension/~/ring-out", {
    method: "POST",
    json: {
      from: { phoneNumber: input.fromE164 },
      to: { phoneNumber: input.toE164 },
      playPrompt: false,
    },
  });
}

export async function getRingOut(id: string): Promise<RingOutResult> {
  return rcFetch<RingOutResult>(
    `/restapi/v1.0/account/~/extension/~/ring-out/${encodeURIComponent(id)}`,
    { method: "GET" },
  );
}

export type SmsResult = {
  id: string;
  messageStatus?: string;
};

export async function sendSms(input: {
  fromE164: string;
  toE164: string;
  text: string;
}): Promise<SmsResult> {
  return rcFetch<SmsResult>("/restapi/v1.0/account/~/extension/~/sms", {
    method: "POST",
    json: {
      from: { phoneNumber: input.fromE164 },
      to: [{ phoneNumber: input.toE164 }],
      text: input.text,
    },
  });
}
