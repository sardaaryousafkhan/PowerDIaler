import type { FastifyReply } from "fastify";
import {
  FUNCTION_PERMISSION_KEYS,
  defaultPermissionsForOrgRole,
  type FunctionPermissionKey,
  type OrgRolePublic,
} from "@powerdialer/shared";
import { prisma } from "../db.js";

export type OrgAuth = {
  sub: string;
  role: "user" | "admin" | "owner";
  email: string;
  name: string;
  orgId: string | null;
  orgRole: OrgRolePublic | null;
  membershipId: string | null;
  tokenVersion?: number;
};

export type FunctionAccessMap = Record<FunctionPermissionKey, boolean>;

function mergePermissions(base: FunctionAccessMap, raw: unknown): FunctionAccessMap {
  const map = { ...base };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return map;
  for (const key of FUNCTION_PERMISSION_KEYS) {
    const val = (raw as Record<string, unknown>)[key];
    if (typeof val === "boolean") map[key] = val;
  }
  return map;
}

export function resolvePermissions(
  orgRole: OrgRolePublic | null,
  membershipPermissionsJson?: string | null,
): FunctionAccessMap {
  if (!orgRole) {
    return Object.fromEntries(FUNCTION_PERMISSION_KEYS.map((k) => [k, false])) as FunctionAccessMap;
  }
  const base = defaultPermissionsForOrgRole(orgRole) as FunctionAccessMap;
  if (orgRole === "ORG_OWNER" || orgRole === "ORG_ADMIN") return base;
  try {
    return mergePermissions(base, membershipPermissionsJson ? JSON.parse(membershipPermissionsJson) : {});
  } catch {
    return base;
  }
}

export function isOrgAdminRole(orgRole: OrgRolePublic | null | undefined): boolean {
  return orgRole === "ORG_OWNER" || orgRole === "ORG_ADMIN";
}

export function isPlatformAdmin(auth: OrgAuth | null | undefined): boolean {
  return auth?.role === "admin" || auth?.role === "owner";
}

export async function requireAuth(
  req: { auth: Partial<OrgAuth> | OrgAuth | null },
  reply: FastifyReply,
): Promise<OrgAuth | null> {
  if (!req.auth?.sub || !req.auth.role) {
    reply.code(401).send({ error: "Unauthorized" });
    return null;
  }
  return {
    sub: req.auth.sub,
    role: req.auth.role,
    email: req.auth.email ?? "",
    name: req.auth.name ?? "",
    orgId: req.auth.orgId ?? null,
    orgRole: req.auth.orgRole ?? null,
    membershipId: req.auth.membershipId ?? null,
    tokenVersion: req.auth.tokenVersion,
  };
}

export async function requireOrg(
  req: { auth: Partial<OrgAuth> | OrgAuth | null },
  reply: FastifyReply,
): Promise<(OrgAuth & { orgId: string; orgRole: OrgRolePublic; membershipId: string }) | null> {
  const auth = await requireAuth(req, reply);
  if (!auth) return null;
  if (isPlatformAdmin(auth) && auth.orgId && auth.orgRole && auth.membershipId) {
    return auth as OrgAuth & { orgId: string; orgRole: OrgRolePublic; membershipId: string };
  }
  if (!auth.orgId || !auth.orgRole || !auth.membershipId) {
    reply.code(403).send({ error: "No active organization membership" });
    return null;
  }
  return auth as OrgAuth & { orgId: string; orgRole: OrgRolePublic; membershipId: string };
}

export async function requirePermission(
  req: { auth: Partial<OrgAuth> | OrgAuth | null },
  reply: FastifyReply,
  permission: FunctionPermissionKey,
): Promise<(OrgAuth & { orgId: string }) | null> {
  const auth = await requireOrg(req, reply);
  if (!auth) return null;
  // Platform operators still bypass; ORG_ADMIN short-circuit removed (Batch 4).
  // enforceFunctionAccess delegates here — no separate Admin short-circuit to remove.
  if (isPlatformAdmin(auth)) return auth;
  const membership = await prisma.membership.findUnique({
    where: { id: auth.membershipId },
    select: { permissions: true, orgRole: true, status: true },
  });
  if (!membership || membership.status !== "ACTIVE") {
    reply.code(403).send({ error: "Membership inactive" });
    return null;
  }
  const access = resolvePermissions(membership.orgRole, membership.permissions);
  if (!access[permission]) {
    reply.code(403).send({ error: `Access denied for ${permission}` });
    return null;
  }
  return auth;
}

/** Campaign visible if same org and (admin or assigned or creator with view). */
export async function canAccessCampaign(
  auth: OrgAuth & { orgId: string; orgRole: OrgRolePublic },
  campaignId: string,
): Promise<boolean> {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId: auth.orgId },
    select: { id: true },
  });
  if (!campaign) return false;
  if (isPlatformAdmin(auth) || isOrgAdminRole(auth.orgRole)) return true;
  const assignment = await prisma.campaignAssignment.findUnique({
    where: { campaignId_userId: { campaignId, userId: auth.sub } },
    select: { id: true },
  });
  return Boolean(assignment);
}

export async function campaignWhereForUser(auth: OrgAuth & { orgId: string; orgRole: OrgRolePublic }) {
  if (isPlatformAdmin(auth) || isOrgAdminRole(auth.orgRole)) {
    return { organizationId: auth.orgId };
  }
  return {
    organizationId: auth.orgId,
    assignments: { some: { userId: auth.sub } },
  };
}

export async function writeAuditLog(input: {
  organizationId?: string | null;
  actorUserId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: input.organizationId ?? null,
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        meta: JSON.stringify(input.meta ?? {}),
      },
    });
  } catch (err) {
    console.error("[audit] write failed", err);
  }
}

export function slugifyOrgName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return base || "org";
}

export async function uniqueOrgSlug(baseName: string): Promise<string> {
  const base = slugifyOrgName(baseName);
  let slug = base;
  let i = 0;
  while (await prisma.organization.findUnique({ where: { slug } })) {
    i += 1;
    slug = `${base}-${i}`;
  }
  return slug;
}
