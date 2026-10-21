import { env } from "../env.js";
import { getZoomAccessToken } from "../auth/zoomOAuth.js";
import type { ZoomCredentials } from "../auth/zoomCredentials.js";
import { resolveZoomCredentials } from "../auth/zoomCredentials.js";

async function logZoomError(operation: string, res: Response): Promise<void> {
  let body = "";
  try {
    body = await res.text();
  } catch {
    body = "(unreadable body)";
  }
  console.error(`[bridge:zoom] ${operation} failed`, { status: res.status, body: body.slice(0, 500) });
}

export async function getUserSmsEnabled(
  userId: string,
  credentials?: ZoomCredentials | null,
): Promise<boolean> {
  const token = await getZoomAccessToken(credentials);
  if (!token) {
    console.warn("[bridge:zoom] getUserSmsEnabled: no access token");
    return false;
  }
  const res = await fetch(`https://api.zoom.us/v2/phone/users/${userId}/settings`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    await logZoomError(`GET /phone/users/${userId}/settings`, res);
    // Newer accounts may omit sms.enable; still allow send attempt if user has a number.
    return true;
  }
  const data = (await res.json()) as { sms?: { enable?: boolean } };
  // If Zoom returns an explicit false, block. Missing field → try send (new SMS API).
  if (data.sms && data.sms.enable === false) return false;
  return true;
}

/**
 * Best-effort SMS send via current Zoom Phone SMS API.
 * Docs (May 2025+): POST /phone/sms/messages
 */
export async function sendZoomSms(
  userId: string,
  toE164: string,
  body: string,
  credentials?: ZoomCredentials | null,
): Promise<string | null> {
  const creds = resolveZoomCredentials(credentials ?? null);
  const token = await getZoomAccessToken(creds);
  if (!token) {
    console.warn("[bridge:zoom] sendZoomSms: no access token");
    return null;
  }
  const senderPhone = creds?.callerId?.trim() || env.ZOOM_PHONE_CALLER_ID?.trim();
  if (!senderPhone) {
    console.warn("[bridge:zoom] sendZoomSms: missing sender phone (ZOOM_PHONE_CALLER_ID)");
    return null;
  }
  const res = await fetch(`https://api.zoom.us/v2/phone/sms/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      message: body.slice(0, 500),
      sender: {
        user_id: userId,
        phone_number: senderPhone,
      },
      to_members: [{ phone_number: toE164 }],
    }),
  });
  if (!res.ok) {
    await logZoomError(`POST /phone/sms/messages`, res);
    return null;
  }
  const data = (await res.json()) as { message_id?: string; id?: string; session_id?: string };
  return data.message_id ?? data.id ?? data.session_id ?? null;
}

export async function checkZoomUserLicense(
  userId: string,
  credentials?: ZoomCredentials | null,
): Promise<boolean> {
  const token = await getZoomAccessToken(credentials);
  if (!token) return env.ZOOM_BRIDGE_MODE === "mock";
  const res = await fetch(`https://api.zoom.us/v2/phone/users/${userId}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) await logZoomError(`GET /phone/users/${userId}`, res);
  return res.ok;
}
