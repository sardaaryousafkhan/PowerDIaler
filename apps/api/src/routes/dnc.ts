import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { e164Schema } from "@powerdialer/shared";
import { prisma } from "../db.js";
import { requireOrg, requirePermission, writeAuditLog } from "../lib/orgAccess.js";
import { isRbacEnforceAdminPerms } from "../rbac/enforceFlag.js";
import { denyWithAudit, requirePermissionBatch1 } from "../rbac/permissionGate.js";
import { teamUserIdsForActor } from "../rbac/teamScope.js";

const addSchema = z.object({
  e164: e164Schema,
});

export async function dncRoutes(app: FastifyInstance): Promise<void> {
  app.get("/dnc", async (req, reply) => {
    const auth = isRbacEnforceAdminPerms()
      ? await requirePermissionBatch1(req, reply, "dnc_manage", "GET /dnc")
      : await requireOrg(req, reply);
    if (!auth) return;

    let where: { organizationId: string; createdByUserId?: { in: string[] } } = {
      organizationId: auth.orgId,
    };

    if (isRbacEnforceAdminPerms() && auth.orgRole === "ORG_ADMIN") {
      const teamIds = await teamUserIdsForActor(auth);
      const ownerMembership = await prisma.membership.findFirst({
        where: { organizationId: auth.orgId, orgRole: "ORG_OWNER", status: "ACTIVE" },
        select: { userId: true },
      });
      const allowedCreators = [
        auth.sub,
        ...(teamIds === "all" ? [] : teamIds),
        ...(ownerMembership ? [ownerMembership.userId] : []),
      ];
      where = {
        organizationId: auth.orgId,
        createdByUserId: { in: allowedCreators },
      };
    }

    return prisma.dncEntry.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 2000,
    });
  });

  app.post("/dnc", async (req, reply) => {
    const auth = isRbacEnforceAdminPerms()
      ? await requirePermissionBatch1(req, reply, "dnc_manage", "POST /dnc")
      : await requirePermission(req, reply, "dnc_manage");
    if (!auth) return;
    const parsed = addSchema.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return reply.code(400).send({ error: issue?.message ?? "Invalid E.164 (+countrycode...)" });
    }
    const body = parsed.data;
    const row = await prisma.dncEntry.upsert({
      where: {
        organizationId_e164: { organizationId: auth.orgId, e164: body.e164 },
      },
      create: { organizationId: auth.orgId, e164: body.e164, createdByUserId: auth.sub },
      update: {},
    });
    await writeAuditLog({
      organizationId: auth.orgId,
      actorUserId: auth.sub,
      action: "dnc.add",
      entityType: "DncEntry",
      entityId: row.id,
      meta: { e164: body.e164 },
    });
    return reply.code(201).send(row);
  });

  app.delete("/dnc/:e164", async (req, reply) => {
    const auth = isRbacEnforceAdminPerms()
      ? await requirePermissionBatch1(req, reply, "dnc_delete", "DELETE /dnc/:e164")
      : await requirePermission(req, reply, "dnc_manage");
    if (!auth) return;
    const e164 = decodeURIComponent((req.params as { e164: string }).e164);
    const parsed = e164Schema.safeParse(e164);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid E.164" });

    const existing = await prisma.dncEntry.findFirst({
      where: { organizationId: auth.orgId, e164: parsed.data },
    });
    if (!existing) return reply.code(404).send({ error: "Not found" });

    if (isRbacEnforceAdminPerms() && auth.orgRole === "ORG_ADMIN") {
      const ownerMembership = await prisma.membership.findFirst({
        where: { organizationId: auth.orgId, orgRole: "ORG_OWNER", status: "ACTIVE" },
        select: { userId: true },
      });
      if (existing.createdByUserId === ownerMembership?.userId) {
        await denyWithAudit(reply, auth, {
          path: "DELETE /dnc/:e164",
          requiredPermission: "dnc_delete",
          reason: "owner_dnc_delete_protected",
        });
        return;
      }
      const teamIds = await teamUserIdsForActor(auth);
      const allowed = [auth.sub, ...(teamIds === "all" ? [] : teamIds)];
      if (!existing.createdByUserId || !allowed.includes(existing.createdByUserId)) {
        await denyWithAudit(reply, auth, {
          path: "DELETE /dnc/:e164",
          requiredPermission: "dnc_delete",
          reason: "cross_team_dnc",
        });
        return;
      }
    }

    await prisma.dncEntry.deleteMany({
      where: { organizationId: auth.orgId, e164: parsed.data },
    });
    await writeAuditLog({
      organizationId: auth.orgId,
      actorUserId: auth.sub,
      action: "dnc.remove",
      entityType: "DncEntry",
      meta: { e164: parsed.data },
    });
    return { ok: true };
  });
}
