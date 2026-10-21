import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { integrationProviderIdSchema } from "@powerdialer/shared";
import { callCrmBridge, isCrmBridgeConfigured } from "../lib/crmBridge.js";
import { prisma } from "../db.js";
import { denyWithAudit, requirePermissionBatch1 } from "../rbac/permissionGate.js";
import { isRbacEnforceAdminPerms } from "../rbac/enforceFlag.js";
import { isUserInActorTeam, teamUserIdsForActor } from "../rbac/teamScope.js";
import type { OrgAuth } from "../lib/orgAccess.js";
import type { OrgRolePublic } from "@powerdialer/shared";

const upsertContactSchema = z.object({
  provider: integrationProviderIdSchema,
  externalId: z.string().trim().min(1).optional(),
  email: z.string().trim().email().optional(),
  phoneE164: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{1,14}$/)
    .optional(),
  firstName: z.string().trim().optional(),
  lastName: z.string().trim().optional(),
  company: z.string().trim().optional(),
  ownerExternalId: z.string().trim().optional(),
  /** Power Dialer user owner — required for Admin when RBAC_ENFORCE_ADMIN_PERMS is on. */
  assignedUserId: z.string().trim().min(1).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const logActivitySchema = z.object({
  provider: integrationProviderIdSchema,
  contactExternalId: z.string().trim().min(1).optional(),
  contactEmail: z.string().trim().email().optional(),
  campaignId: z.string().trim().optional(),
  contactId: z.string().trim().optional(),
  assignedUserId: z.string().trim().min(1).optional(),
  type: z.enum(["call", "sms", "note"]),
  status: z.string().trim().optional(),
  direction: z.enum(["outbound", "inbound"]).optional(),
  occurredAt: z.string().datetime().optional(),
  summary: z.string().trim().min(1),
  raw: z.record(z.unknown()).optional(),
});

const providerStatusSchema = z.object({
  provider: integrationProviderIdSchema,
});

type Authed = OrgAuth & { orgId: string; orgRole: OrgRolePublic; membershipId: string };

/**
 * Resolve write target user for CRM ops.
 * Enforce on + Admin: assignedUserId required; must be on Admin's team.
 * Enforce on + Agent: defaults to self; if provided must === self.
 * Enforce off: optional (compat); no team check.
 */
async function resolveWriteAssignedUserId(
  reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  auth: Authed,
  path: string,
  assignedUserId: string | undefined,
): Promise<string | null | undefined> {
  if (!isRbacEnforceAdminPerms()) {
    return assignedUserId ?? auth.sub;
  }

  if (auth.orgRole === "ORG_ADMIN") {
    if (!assignedUserId) {
      await denyWithAudit(reply as never, auth, {
        path,
        requiredPermission: "crm_view",
        reason: "assignedUserId_required_for_admin",
      });
      return null;
    }
    const ok = await isUserInActorTeam(auth, assignedUserId);
    if (!ok) {
      await denyWithAudit(reply as never, auth, {
        path,
        requiredPermission: "crm_view",
        reason: "cross_team_assignedUserId",
      });
      return null;
    }
    return assignedUserId;
  }

  if (auth.orgRole === "AGENT") {
    const target = assignedUserId ?? auth.sub;
    if (target !== auth.sub) {
      await denyWithAudit(reply as never, auth, {
        path,
        requiredPermission: "crm_view",
        reason: "agent_self_only",
      });
      return null;
    }
    return target;
  }

  // Owner
  return assignedUserId ?? auth.sub;
}

export async function crmRoutes(app: FastifyInstance): Promise<void> {
  app.get("/crm/providers/:provider/status", async (req, reply) => {
    // E09: always crm_manage (Owner-only under enforce; Admin bypass when flag off).
    const auth = await requirePermissionBatch1(req, reply, "crm_manage", "GET /crm/providers/:provider/status");
    if (!auth) return;
    const provider = providerStatusSchema.parse(req.params).provider;
    const hasBridge = isCrmBridgeConfigured(provider);
    return {
      provider,
      configured: true,
      mode: hasBridge ? "bridge" : "built_in",
    };
  });

  app.post("/crm/contacts/upsert", async (req, reply) => {
    // Flag off: legacy crm_manage (no Agent expansion). Flag on: crm_view + write-time team check.
    const key = isRbacEnforceAdminPerms() ? "crm_view" : "crm_manage";
    const auth = await requirePermissionBatch1(req, reply, key, "POST /crm/contacts/upsert");
    if (!auth) return;
    const body = upsertContactSchema.parse(req.body);
    const assignedUserId = await resolveWriteAssignedUserId(
      reply,
      auth,
      "POST /crm/contacts/upsert",
      body.assignedUserId,
    );
    if (assignedUserId === null) return;

    if (!isCrmBridgeConfigured(body.provider)) {
      const record = await prisma.crmContact.create({
        data: {
          organizationId: auth.orgId,
          provider: body.provider,
          externalId: body.externalId,
          email: body.email,
          phoneE164: body.phoneE164,
          firstName: body.firstName,
          lastName: body.lastName,
          company: body.company,
          ownerExternalId: body.ownerExternalId,
          assignedUserId: assignedUserId ?? undefined,
          metadata: body.metadata as never,
        },
      });
      return reply.send({
        ok: true,
        provider: body.provider,
        result: { externalId: record.externalId ?? record.id, synced: true, mode: "built_in" },
      });
    }
    const result = await callCrmBridge<{ externalId?: string; synced?: boolean }>(body.provider, "/crm/contacts/upsert", {
      externalId: body.externalId,
      email: body.email,
      phoneE164: body.phoneE164,
      firstName: body.firstName,
      lastName: body.lastName,
      company: body.company,
      ownerExternalId: body.ownerExternalId,
      metadata: body.metadata,
    });
    if (result.ok) {
      await prisma.crmContact.create({
        data: {
          organizationId: auth.orgId,
          provider: body.provider,
          externalId: body.externalId ?? (result.data?.externalId as string | undefined),
          email: body.email,
          phoneE164: body.phoneE164,
          firstName: body.firstName,
          lastName: body.lastName,
          company: body.company,
          ownerExternalId: body.ownerExternalId,
          assignedUserId: assignedUserId ?? undefined,
          metadata: body.metadata as never,
        },
      });
      return reply.send({
        ok: true,
        provider: body.provider,
        result: result.data ?? {},
      });
    }
    const record = await prisma.crmContact.create({
      data: {
        organizationId: auth.orgId,
        provider: body.provider,
        externalId: body.externalId,
        email: body.email,
        phoneE164: body.phoneE164,
        firstName: body.firstName,
        lastName: body.lastName,
        company: body.company,
        ownerExternalId: body.ownerExternalId,
        assignedUserId: assignedUserId ?? undefined,
        metadata: body.metadata as never,
      },
    });
    return reply.send({
      ok: true,
      provider: body.provider,
      result: {
        externalId: record.externalId ?? record.id,
        synced: true,
        mode: "built_in_fallback",
        bridgeError: result.error ?? "bridge call failed",
      },
    });
  });

  app.post("/crm/activities/log", async (req, reply) => {
    const key = isRbacEnforceAdminPerms() ? "crm_view" : "crm_manage";
    const auth = await requirePermissionBatch1(req, reply, key, "POST /crm/activities/log");
    if (!auth) return;
    const body = logActivitySchema.parse(req.body);
    const assignedUserId = await resolveWriteAssignedUserId(
      reply,
      auth,
      "POST /crm/activities/log",
      body.assignedUserId,
    );
    if (assignedUserId === null) return;

    if (!isCrmBridgeConfigured(body.provider)) {
      const activity = await prisma.crmActivity.create({
        data: {
          organizationId: auth.orgId,
          provider: body.provider,
          contactExternalId: body.contactExternalId,
          contactEmail: body.contactEmail,
          campaignId: body.campaignId,
          contactId: body.contactId,
          assignedUserId: assignedUserId ?? undefined,
          type: body.type,
          status: body.status,
          direction: body.direction,
          occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
          summary: body.summary,
          raw: body.raw as never,
        },
      });
      return reply.send({
        ok: true,
        provider: body.provider,
        result: { activityId: activity.id, logged: true, mode: "built_in" },
      });
    }
    const result = await callCrmBridge<{ activityId?: string; logged?: boolean }>(body.provider, "/crm/activities/log", {
      contactExternalId: body.contactExternalId,
      contactEmail: body.contactEmail,
      campaignId: body.campaignId,
      contactId: body.contactId,
      type: body.type,
      status: body.status,
      direction: body.direction,
      occurredAt: body.occurredAt ?? new Date().toISOString(),
      summary: body.summary,
      raw: body.raw,
    });
    if (result.ok) {
      await prisma.crmActivity.create({
        data: {
          organizationId: auth.orgId,
          provider: body.provider,
          contactExternalId: body.contactExternalId,
          contactEmail: body.contactEmail,
          campaignId: body.campaignId,
          contactId: body.contactId,
          assignedUserId: assignedUserId ?? undefined,
          type: body.type,
          status: body.status,
          direction: body.direction,
          occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
          summary: body.summary,
          raw: body.raw as never,
        },
      });
      return reply.send({
        ok: true,
        provider: body.provider,
        result: result.data ?? {},
      });
    }
    const activity = await prisma.crmActivity.create({
      data: {
        organizationId: auth.orgId,
        provider: body.provider,
        contactExternalId: body.contactExternalId,
        contactEmail: body.contactEmail,
        campaignId: body.campaignId,
        contactId: body.contactId,
        assignedUserId: assignedUserId ?? undefined,
        type: body.type,
        status: body.status,
        direction: body.direction,
        occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
        summary: body.summary,
        raw: body.raw as never,
      },
    });
    return reply.send({
      ok: true,
      provider: body.provider,
      result: {
        activityId: activity.id,
        logged: true,
        mode: "built_in_fallback",
        bridgeError: result.error ?? "bridge call failed",
      },
    });
  });

  app.get("/crm/activities", async (req, reply) => {
    // Flag off: legacy crm_manage. Flag on: crm_view; Agent team-list → 403 (E10).
    const key = isRbacEnforceAdminPerms() ? "crm_view" : "crm_manage";
    const auth = await requirePermissionBatch1(req, reply, key, "GET /crm/activities");
    if (!auth) return;

    if (isRbacEnforceAdminPerms() && auth.orgRole === "AGENT") {
      await denyWithAudit(reply, auth, {
        path: "GET /crm/activities",
        requiredPermission: "crm_view",
        reason: "agent_team_list_denied",
      });
      return;
    }

    const query = z
      .object({
        provider: integrationProviderIdSchema.optional(),
        limit: z.coerce.number().min(1).max(200).default(50),
      })
      .parse(req.query ?? {});

    const teamIds = isRbacEnforceAdminPerms() ? await teamUserIdsForActor(auth) : ("all" as const);
    const rows = await prisma.crmActivity.findMany({
      where: {
        organizationId: auth.orgId,
        ...(query.provider ? { provider: query.provider } : {}),
        ...(teamIds === "all" ? {} : { assignedUserId: { in: teamIds } }),
      },
      orderBy: { createdAt: "desc" },
      take: query.limit,
    });
    return { items: rows };
  });
}
