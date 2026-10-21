import type { FastifyReply } from "fastify";
import type { FunctionPermissionKey } from "@powerdialer/shared";
import {
  requirePermission,
  type OrgAuth,
  type FunctionAccessMap,
  resolvePermissions,
} from "./lib/orgAccess.js";
import { prisma } from "./db.js";
import { FUNCTION_PERMISSION_KEYS } from "@powerdialer/shared";

export type { FunctionAccessMap };

const ALL_ALLOWED: FunctionAccessMap = Object.fromEntries(
  FUNCTION_PERMISSION_KEYS.map((k) => [k, true]),
) as FunctionAccessMap;

export function serializePermissionMap(input: Partial<FunctionAccessMap>): string {
  const map = { ...ALL_ALLOWED, ...input };
  return JSON.stringify(map);
}

export async function getFunctionAccessForUser(userId: string): Promise<FunctionAccessMap> {
  const membership = await prisma.membership.findFirst({
    where: { userId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  });
  if (membership) return resolvePermissions(membership.orgRole, membership.permissions);
  const row = await prisma.userFunctionAccess.findUnique({ where: { userId } });
  if (!row) return { ...ALL_ALLOWED };
  try {
    return { ...ALL_ALLOWED, ...JSON.parse(row.permissions) };
  } catch {
    return { ...ALL_ALLOWED };
  }
}

/** Backward-compatible permission check (org-aware). */
export async function enforceFunctionAccess(
  req: { auth: Partial<OrgAuth> | null },
  reply: FastifyReply,
  permission: FunctionPermissionKey,
): Promise<boolean> {
  const ok = await requirePermission(req as { auth: OrgAuth | null }, reply, permission);
  return Boolean(ok);
}
