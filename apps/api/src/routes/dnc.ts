import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { e164Schema } from "@powerdialer/shared";
import { prisma } from "../db.js";
import { requireOrg, requirePermission, writeAuditLog } from "../lib/orgAccess.js";

const addSchema = z.object({
  e164: e164Schema,
});

export async function dncRoutes(app: FastifyInstance): Promise<void> {
  app.get("/dnc", async (req, reply) => {
    const auth = await requireOrg(req, reply);
    if (!auth) return;
    return prisma.dncEntry.findMany({
      where: { organizationId: auth.orgId },
      orderBy: { createdAt: "desc" },
      take: 2000,
    });
  });

  app.post("/dnc", async (req, reply) => {
    const auth = await requirePermission(req, reply, "dnc_manage");
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
      create: { organizationId: auth.orgId, e164: body.e164 },
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
    const auth = await requirePermission(req, reply, "dnc_manage");
    if (!auth) return;
    const e164 = decodeURIComponent((req.params as { e164: string }).e164);
    const parsed = e164Schema.safeParse(e164);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid E.164" });
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
