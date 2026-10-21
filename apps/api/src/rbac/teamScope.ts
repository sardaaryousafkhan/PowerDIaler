import type { OrgRolePublic } from "@powerdialer/shared";
import { prisma } from "../db.js";

export type ScopedAuth = {
  sub: string;
  orgId: string;
  orgRole: OrgRolePublic;
  membershipId: string;
};

/**
 * Team = Users managed by this Admin, or Owner-direct (managedByAdminId IS NULL) when actor is Owner.
 */
export async function isUserInActorTeam(auth: ScopedAuth, targetUserId: string): Promise<boolean> {
  if (auth.orgRole === "ORG_OWNER") {
    const m = await prisma.membership.findFirst({
      where: { organizationId: auth.orgId, userId: targetUserId, status: "ACTIVE" },
      select: { id: true },
    });
    return Boolean(m);
  }
  if (auth.orgRole === "ORG_ADMIN") {
    const m = await prisma.membership.findFirst({
      where: {
        organizationId: auth.orgId,
        userId: targetUserId,
        status: "ACTIVE",
        managedByAdminId: auth.membershipId,
      },
      select: { id: true },
    });
    return Boolean(m);
  }
  // AGENT: self only
  return targetUserId === auth.sub;
}

export async function teamUserIdsForActor(auth: ScopedAuth): Promise<string[] | "all"> {
  if (auth.orgRole === "ORG_OWNER") return "all";
  if (auth.orgRole === "ORG_ADMIN") {
    const rows = await prisma.membership.findMany({
      where: {
        organizationId: auth.orgId,
        status: "ACTIVE",
        managedByAdminId: auth.membershipId,
      },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }
  return [auth.sub];
}
