import type { FastifyReply } from "fastify";
import { prisma } from "../db.js";
import { denyWithAudit } from "./permissionGate.js";
import { isCampaignOwnedByActor, type ScopedAuth } from "./teamScope.js";
import { isRbacEnforceAdminPerms } from "./enforceFlag.js";

/**
 * When enforce on: Owner any; Admin startedBy-owned; Agent assigned.
 * Returns campaign row or null after sending 403/404.
 */
export async function loadCampaignIfAccessible(
  reply: FastifyReply,
  auth: ScopedAuth,
  campaignId: string,
  path: string,
  requiredPermission: string,
): Promise<{ id: string; startedByUserId: string | null; organizationId: string | null } | null> {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId: auth.orgId },
    select: { id: true, startedByUserId: true, organizationId: true },
  });
  if (!campaign) {
    reply.code(404).send({ error: "Not found" });
    return null;
  }

  if (!isRbacEnforceAdminPerms()) {
    return campaign;
  }

  if (auth.orgRole === "ORG_OWNER") return campaign;

  if (auth.orgRole === "ORG_ADMIN") {
    const owned = await isCampaignOwnedByActor(auth, campaign);
    if (!owned) {
      await denyWithAudit(reply, auth, {
        path,
        requiredPermission,
        reason: "cross_team_campaign",
      });
      return null;
    }
    return campaign;
  }

  // AGENT — assigned
  const assignment = await prisma.campaignAssignment.findUnique({
    where: { campaignId_userId: { campaignId, userId: auth.sub } },
    select: { id: true },
  });
  if (!assignment) {
    await denyWithAudit(reply, auth, {
      path,
      requiredPermission,
      reason: "not_assigned",
    });
    return null;
  }
  return campaign;
}
