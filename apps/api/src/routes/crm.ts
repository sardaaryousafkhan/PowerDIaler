import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { integrationProviderIdSchema } from "@powerdialer/shared";
import { callCrmBridge, isCrmBridgeConfigured } from "../lib/crmBridge.js";
import { enforceFunctionAccess } from "../functionAccess.js";
import { prisma } from "../db.js";
import { requireOrg } from "../lib/orgAccess.js";

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
  metadata: z.record(z.unknown()).optional(),
});

const logActivitySchema = z.object({
  provider: integrationProviderIdSchema,
  contactExternalId: z.string().trim().min(1).optional(),
  contactEmail: z.string().trim().email().optional(),
  campaignId: z.string().trim().optional(),
  contactId: z.string().trim().optional(),
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

export async function crmRoutes(app: FastifyInstance): Promise<void> {
  app.get("/crm/providers/:provider/status", async (req, reply) => {
    if (
      !(await enforceFunctionAccess(
        req as { auth: { sub: string; role: "user" | "admin" | "owner" } | null },
        reply,
        "crm_manage",
      ))
    ) {
      return;
    }
    const provider = providerStatusSchema.parse(req.params).provider;
    const hasBridge = isCrmBridgeConfigured(provider);
    return {
      provider,
      configured: true,
      mode: hasBridge ? "bridge" : "built_in",
    };
  });

  app.post("/crm/contacts/upsert", async (req, reply) => {
    if (
      !(await enforceFunctionAccess(
        req as { auth: { sub: string; role: "user" | "admin" | "owner" } | null },
        reply,
        "crm_manage",
      ))
    ) {
      return;
    }

    const auth = await requireOrg(req, reply);
    if (!auth) return;
    const body = upsertContactSchema.parse(req.body);
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
    if (
      !(await enforceFunctionAccess(
        req as { auth: { sub: string; role: "user" | "admin" | "owner" } | null },
        reply,
        "crm_manage",
      ))
    ) {
      return;
    }

    const auth = await requireOrg(req, reply);
    if (!auth) return;
    const body = logActivitySchema.parse(req.body);
    if (!isCrmBridgeConfigured(body.provider)) {
      const activity = await prisma.crmActivity.create({
        data: {
          organizationId: auth.orgId,
          provider: body.provider,
          contactExternalId: body.contactExternalId,
          contactEmail: body.contactEmail,
          campaignId: body.campaignId,
          contactId: body.contactId,
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
    if (
      !(await enforceFunctionAccess(
        req as { auth: { sub: string; role: "user" | "admin" | "owner" } | null },
        reply,
        "crm_manage",
      ))
    ) {
      return;
    }
    const query = z
      .object({
        provider: integrationProviderIdSchema.optional(),
        limit: z.coerce.number().min(1).max(200).default(50),
      })
      .parse(req.query ?? {});
    const auth = await requireOrg(req, reply);
    if (!auth) return;
    const rows = await prisma.crmActivity.findMany({
      where: {
        organizationId: auth.orgId,
        ...(query.provider ? { provider: query.provider } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: query.limit,
    });
    return { items: rows };
  });
}
