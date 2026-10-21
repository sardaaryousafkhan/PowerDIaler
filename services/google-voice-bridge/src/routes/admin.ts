import type { FastifyInstance } from "fastify";
import { verifyApiKey } from "../auth/apiKey.js";
import { prisma } from "../db.js";

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/outbox", async (req, reply) => {
    if (!verifyApiKey(req)) return reply.code(401).send({ error: "Unauthorized" });
    const q = req.query as { deadLetter?: string; limit?: string };
    const dl = q.deadLetter === "true";
    const take = Math.min(Number(q.limit ?? 50), 200);
    const rows = await prisma.callbackOutbox.findMany({
      where: dl ? { deadLetter: true } : {},
      orderBy: { createdAt: "desc" },
      take,
    });
    return reply.send({ count: rows.length, rows });
  });

  app.get("/admin/outbox/stats", async (req, reply) => {
    if (!verifyApiKey(req)) return reply.code(401).send({ error: "Unauthorized" });
    const [pending, deadLetter] = await Promise.all([
      prisma.callbackOutbox.count({ where: { deadLetter: false } }),
      prisma.callbackOutbox.count({ where: { deadLetter: true } }),
    ]);
    return reply.send({ pending, deadLetter });
  });

  app.post("/admin/outbox/:id/replay", async (req, reply) => {
    if (!verifyApiKey(req)) return reply.code(401).send({ error: "Unauthorized" });
    const { id } = req.params as { id: string };
    const row = await prisma.callbackOutbox.findUnique({ where: { id } });
    if (!row) return reply.code(404).send({ error: "Not found" });
    await prisma.callbackOutbox.update({
      where: { id },
      data: { deadLetter: false, attempts: 0, nextRetryAt: new Date(), lastError: null },
    });
    return reply.send({ ok: true, id });
  });

  app.post("/admin/outbox/replay-all-dlq", async (req, reply) => {
    if (!verifyApiKey(req)) return reply.code(401).send({ error: "Unauthorized" });
    const result = await prisma.callbackOutbox.updateMany({
      where: { deadLetter: true },
      data: { deadLetter: false, attempts: 0, nextRetryAt: new Date(), lastError: null },
    });
    return reply.send({ ok: true, replayed: result.count });
  });
}
