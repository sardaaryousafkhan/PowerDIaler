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
  /** Read team CRM + operational upsert/log (self/team). Write-key split deferred. */
  "crm_view",
  "members_manage",
  /** Owner-only invite (split from members_manage). */
  "members_invite",
  /** Owner-only role change / demote (split from members_manage). */
  "members_change_role",
  /** Owner-only User → Admin assignment. */
  "assign_user_to_admin",
  /** DNC delete (Owner any; Admin team-added only — enforced in later batch). */
  "dnc_delete",
  "reports_export",
  "recordings_view_self",
  "audit_view",
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

/**
 * Alias map (C4): old keys remain valid; new behavior prefers the new key.
 * Do not delete old keys.
 */
export const PERMISSION_KEY_ALIASES: Record<string, FunctionPermissionKey | FunctionPermissionKey[]> = {
  members_manage: ["members_manage", "members_invite", "members_change_role"],
  crm_manage: ["crm_manage", "crm_view"],
  dnc_manage: ["dnc_manage", "dnc_delete"],
};

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
    crm_view: true,
    members_manage: false,
    members_invite: false,
    members_change_role: false,
    assign_user_to_admin: false,
    dnc_delete: false,
    reports_export: false,
    recordings_view_self: false,
    audit_view: false,
    company_settings: false,
    billing_view: false,
    campaign_view: true,
    campaign_dial: true,
    campaign_notes: true,
  };
}
