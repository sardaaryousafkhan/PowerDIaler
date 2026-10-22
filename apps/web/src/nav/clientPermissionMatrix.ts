import type { FunctionPermissionKey, OrgRolePublic } from "@powerdialer/shared";

/**
 * Mirrors apps/api enforceMatrixAllows — used only when rbacNav is on so UI
 * matches backend with RBAC_ENFORCE_ADMIN_PERMS=true. Not a substitute for API checks.
 */
export function clientMatrixAllows(
  orgRole: OrgRolePublic | null | undefined,
  permission: FunctionPermissionKey,
): boolean {
  if (!orgRole) return false;
  if (orgRole === "ORG_OWNER") return true;
  if (orgRole === "ORG_ADMIN") {
    if (permission === "integrations_manage") return false;
    if (permission === "crm_manage") return false;
    if (permission === "billing_view") return false;
    if (permission === "company_settings") return false;
    if (permission === "members_invite") return false;
    if (permission === "members_change_role") return false;
    if (permission === "campaign_dial") return false;
    return true;
  }
  // AGENT
  if (permission === "crm_view") return true;
  if (permission === "campaign_view" || permission === "campaign_dial" || permission === "campaign_notes") {
    return true;
  }
  return false;
}
