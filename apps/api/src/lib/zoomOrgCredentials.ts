import { getOrgSecret, resolveSecret } from "./secrets.js";

export type ZoomOrgCredentials = {
  accountId: string;
  clientId: string;
  clientSecret: string;
  defaultUserId?: string;
  callerId?: string;
};

export const ZOOM_ORG_SECRET_KEYS = {
  accountId: "ZOOM_ACCOUNT_ID",
  clientId: "ZOOM_CLIENT_ID",
  clientSecret: "ZOOM_CLIENT_SECRET",
  defaultUserId: "ZOOM_DEFAULT_USER_ID",
  callerId: "ZOOM_PHONE_CALLER_ID",
} as const;

/** Load Zoom Marketplace credentials for an organization (org secrets, then env fallback). */
export async function loadZoomOrgCredentials(
  organizationId: string | null | undefined,
): Promise<ZoomOrgCredentials | null> {
  const accountId = (await resolveSecret(organizationId, ZOOM_ORG_SECRET_KEYS.accountId))?.trim();
  const clientId = (await resolveSecret(organizationId, ZOOM_ORG_SECRET_KEYS.clientId))?.trim();
  const clientSecret = (await resolveSecret(organizationId, ZOOM_ORG_SECRET_KEYS.clientSecret))?.trim();
  if (!accountId || !clientId || !clientSecret) return null;
  const defaultUserId = (await resolveSecret(organizationId, ZOOM_ORG_SECRET_KEYS.defaultUserId))?.trim();
  const callerId = (await resolveSecret(organizationId, ZOOM_ORG_SECRET_KEYS.callerId))?.trim();
  return {
    accountId,
    clientId,
    clientSecret,
    defaultUserId: defaultUserId || undefined,
    callerId: callerId || undefined,
  };
}

export async function zoomOrgSecretsConfigured(organizationId: string): Promise<boolean> {
  const accountId = await getOrgSecret(organizationId, ZOOM_ORG_SECRET_KEYS.accountId);
  const clientId = await getOrgSecret(organizationId, ZOOM_ORG_SECRET_KEYS.clientId);
  const clientSecret = await getOrgSecret(organizationId, ZOOM_ORG_SECRET_KEYS.clientSecret);
  return Boolean(accountId?.trim() && clientId?.trim() && clientSecret?.trim());
}
