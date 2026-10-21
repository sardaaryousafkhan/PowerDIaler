import Fastify from "fastify";
import formbody from "@fastify/formbody";
import { issueAuthToken, verifyAuthToken, type AuthClaims } from "../../auth.js";
import { adminAccessRoutes } from "../../routes/adminAccess.js";
import { integrationRoutes } from "../../routes/integrations.js";
import { crmRoutes } from "../../routes/crm.js";
import type { OrgRolePublic } from "@powerdialer/shared";

export async function buildBatch1TestApp() {
  const app = Fastify({ logger: false });
  await app.register(formbody);
  app.setErrorHandler((err, _req, reply) => {
    const zodLike = err as { name?: string; issues?: Array<{ message?: string }> };
    if (zodLike?.name === "ZodError" && Array.isArray(zodLike.issues)) {
      return reply.code(400).send({ error: zodLike.issues[0]?.message ?? "Validation failed" });
    }
    return reply.code(500).send({ error: (err as Error).message || "Internal error" });
  });
  app.decorateRequest("auth", null);
  app.addHook("preHandler", async (req) => {
    const authz = String(req.headers.authorization ?? "");
    if (!authz.toLowerCase().startsWith("bearer ")) {
      req.auth = null;
      return;
    }
    req.auth = verifyAuthToken(authz.slice(7).trim());
  });
  await adminAccessRoutes(app);
  await integrationRoutes(app);
  await crmRoutes(app);
  await app.ready();
  return app;
}

export function tokenFor(input: {
  userId: string;
  email: string;
  name: string;
  orgId: string;
  orgRole: OrgRolePublic;
  membershipId: string;
  role?: "user" | "admin" | "owner";
}): string {
  return issueAuthToken({
    userId: input.userId,
    role: input.role ?? (input.orgRole === "ORG_OWNER" ? "owner" : input.orgRole === "ORG_ADMIN" ? "admin" : "user"),
    email: input.email,
    name: input.name,
    orgId: input.orgId,
    orgRole: input.orgRole,
    membershipId: input.membershipId,
  });
}

export type { AuthClaims };
