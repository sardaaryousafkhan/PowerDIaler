import type { FastifyReply } from "fastify";
import type { FunctionPermissionKey, OrgRolePublic } from "@powerdialer/shared";
import {
  requireOrg,
  requirePermission,
  writeAuditLog,
  type OrgAuth,
} from "../lib/orgAccess.js";
import { isRbacEnforceAdminPerms } from "./enforceFlag.js";

type OrgAuthed = OrgAuth & { orgId: string; orgRole: OrgRolePublic; membershipId: string };

/**
 * Narrow matrix used ONLY when RBAC_ENFORCE_ADMIN_PERMS is on.
 * Does not modify orgAccess.requirePermission bypass (Batch 4).
 */
function enforceMatrixAllows(orgRole: OrgRolePublic, permission: FunctionPermissionKey): boolean {
  if (orgRole === "ORG_OWNER") return true;
  if (orgRole === "ORG_ADMIN") {
    // Admin loses Owner-only keys; keeps operational team-scoped keys.
    if (permission === "integrations_manage") return false;
    if (permission === "crm_manage") return false;
    if (permission === "billing_view") return false;
    if (permission === "company_settings") return false;
    if (permission === "members_invite") return false;
    if (permission === "members_change_role") return false;
    if (permission === "crm_view") return true;
    if (permission === "members_manage") return true;
    if (permission === "dnc_manage") return true;
    if (permission === "campaign_view") return true;
    return true; // other operational keys until later batches narrow further
  }
  // AGENT
  if (permission === "crm_view") return true;
  if (permission === "campaign_view" || permission === "campaign_dial" || permission === "campaign_notes") {
    return true;
  }
  return false;
}

export async function denyWithAudit(
  reply: FastifyReply,
  auth: { orgId?: string | null; sub?: string; orgRole?: string | null },
  meta: { path: string; requiredPermission: string; reason?: string },
): Promise<void> {
  await writeAuditLog({
    organizationId: auth.orgId ?? null,
    actorUserId: auth.sub ?? null,
    action: "access.denied",
    entityType: "Permission",
    meta: {
      path: meta.path,
      requiredPermission: meta.requiredPermission,
      orgRole: auth.orgRole ?? null,
      reason: meta.reason ?? "forbidden",
    },
  });
  reply.code(403).send({ error: `Access denied for ${meta.requiredPermission}` });
}

/**
 * Batch-1 gate: when enforce flag off → legacy requirePermission (Admin bypass intact).
 * When enforce flag on → matrix check without Admin short-circuit.
 */
export async function requirePermissionBatch1(
  req: { auth: Partial<OrgAuth> | OrgAuth | null },
  reply: FastifyReply,
  permission: FunctionPermissionKey,
  path: string,
): Promise<OrgAuthed | null> {
  if (!isRbacEnforceAdminPerms()) {
    const auth = await requirePermission(req, reply, permission);
    if (!auth) return null;
    return auth as OrgAuthed;
  }

  const auth = await requireOrg(req, reply);
  if (!auth) return null;

  if (!enforceMatrixAllows(auth.orgRole, permission)) {
    await denyWithAudit(reply, auth, { path, requiredPermission: permission });
    return null;
  }
  return auth;
}
