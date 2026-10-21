import { coerceIntegrationProviderId } from "@powerdialer/shared";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { isBridgeHealthy } from "./bridgeHealth.js";

export async function readPreferredIntegrationKey(organizationId?: string | null): Promise<string> {
  const pref = organizationId
    ? await prisma.integrationPreference.findUnique({ where: { organizationId } })
    : await prisma.integrationPreference.findFirst();
  return coerceIntegrationProviderId(pref?.preferredIntegrationKey ?? "twilio");
}

async function isZoomPhonePreferred(): Promise<boolean> {
  return (await readPreferredIntegrationKey()) === "zoom_phone";
}

/** Manual Zoom desktop dial when bridge is off or unhealthy (or demo without bridge). */
export async function usesZoomPhoneAgentDial(): Promise<boolean> {
  if (!(await isZoomPhonePreferred())) return false;
  if (env.DEMO_MODE && !env.DEMO_USE_BRIDGE) return true;
  return !(await isBridgeHealthy());
}

export function buildZoomPhoneCallUrl(toE164: string, fromE164?: string): string {
  const to = toE164.trim();
  const encodedTo = encodeURIComponent(to);
  const from = fromE164?.trim();
  if (from) {
    return `zoomphonecall://${encodedTo}?callerid=${encodeURIComponent(from)}`;
  }
  return `zoomphonecall://${encodedTo}`;
}

export async function resolveAgentZoomUserId(
  campaignStartedByUserId: string | null,
  organizationId?: string | null,
): Promise<string | undefined> {
  if (campaignStartedByUserId) {
    const user = await prisma.user.findUnique({
      where: { id: campaignStartedByUserId },
      select: { zoomPhoneUserId: true },
    });
    if (user?.zoomPhoneUserId?.trim()) return user.zoomPhoneUserId.trim();
  }
  if (organizationId) {
    const { loadZoomOrgCredentials } = await import("./zoomOrgCredentials.js");
    const creds = await loadZoomOrgCredentials(organizationId);
    if (creds?.defaultUserId?.trim()) return creds.defaultUserId.trim();
  }
  const fallback = env.ZOOM_PHONE_AGENT_USER_ID?.trim() || env.ZOOM_DEFAULT_USER_ID?.trim();
  return fallback || undefined;
}
