import { z } from "zod";

export const FUNCTION_PERMISSION_KEYS = [
  "campaign_create",
  "campaign_delete",
  "contact_import",
  "campaign_start",
  "campaign_pause",
  "campaign_resume",
  "sms_broadcast",
  "dnc_manage",
  "integrations_manage",
  "crm_manage",
  "members_manage",
  "company_settings",
  "billing_view",
  "campaign_view",
  "campaign_dial",
  "campaign_notes",
] as const;

export type FunctionPermissionKey = (typeof FUNCTION_PERMISSION_KEYS)[number];

export const functionPermissionKeySchema = z.enum(FUNCTION_PERMISSION_KEYS);

export const functionPermissionPatchSchema = z.object(
  Object.fromEntries(FUNCTION_PERMISSION_KEYS.map((k) => [k, z.boolean().optional()])) as Record<
    FunctionPermissionKey,
    z.ZodOptional<z.ZodBoolean>
  >,
);

export type FunctionPermissionPatch = z.infer<typeof functionPermissionPatchSchema>;

export const ORG_ROLES = ["ORG_OWNER", "ORG_ADMIN", "AGENT"] as const;
export type OrgRolePublic = (typeof ORG_ROLES)[number];

/** Default permission map by org role (before per-member overrides). */
export function defaultPermissionsForOrgRole(role: OrgRolePublic): Record<FunctionPermissionKey, boolean> {
  const allTrue = Object.fromEntries(FUNCTION_PERMISSION_KEYS.map((k) => [k, true])) as Record<
    FunctionPermissionKey,
    boolean
  >;
  if (role === "ORG_OWNER" || role === "ORG_ADMIN") return allTrue;
  return {
    campaign_create: false,
    campaign_delete: false,
    contact_import: false,
    campaign_start: false,
    campaign_pause: false,
    campaign_resume: false,
    sms_broadcast: false,
    dnc_manage: false,
    integrations_manage: false,
    crm_manage: false,
    members_manage: false,
    company_settings: false,
    billing_view: false,
    campaign_view: true,
    campaign_dial: true,
    campaign_notes: true,
  };
}
