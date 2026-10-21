import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hashPassword, verifyPassword } from "../auth.js";
import { prisma } from "../db.js";

type Settings = {
  theme: "system" | "dark" | "light";
  showDashboardWelcome: boolean;
  logDetailLevel: "summary" | "normal" | "verbose";
};

const DEFAULT_SETTINGS: Settings = {
  theme: "light",
  showDashboardWelcome: true,
  logDetailLevel: "normal",
};

const settingsPatchSchema = z
  .object({
    theme: z.enum(["system", "dark", "light"]),
    showDashboardWelcome: z.boolean(),
    logDetailLevel: z.enum(["summary", "normal", "verbose"]),
  })
  .strict()
  .partial();

const patchBodySchema = z.object({
  settings: settingsPatchSchema,
});

/** Parse persisted JSON with safe defaults; strip unknown keys for forward compatibility. */
const storedSettingsSchema = z
  .object({
    theme: z.enum(["system", "dark", "light"]).default(DEFAULT_SETTINGS.theme),
    showDashboardWelcome: z.boolean().default(DEFAULT_SETTINGS.showDashboardWelcome),
    logDetailLevel: z.enum(["summary", "normal", "verbose"]).default(DEFAULT_SETTINGS.logDetailLevel),
  })
  .strip();

function sanitizeSettings(raw: unknown): Settings {
  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_SETTINGS };
  }
  const parsed = storedSettingsSchema.safeParse(raw);
  if (!parsed.success) return { ...DEFAULT_SETTINGS };
  return parsed.data;
}

function toPublicUserRole(role: "USER" | "ADMIN" | "OWNER"): "user" | "admin" | "owner" {
  if (role === "OWNER") return "owner";
  return role === "ADMIN" ? "admin" : "user";
}

const profilePatchSchema = z.object({
  name: z.string().trim().min(2).max(80),
});

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
});

export async function meRoutes(app: FastifyInstance): Promise<void> {
  app.patch("/me/profile", async (req, reply) => {
    const userId = req.auth?.sub;
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });
    const body = profilePatchSchema.parse(req.body);
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { name: body.name },
      select: { id: true, name: true, email: true, role: true },
    });
    return {
      user: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        role: toPublicUserRole(updated.role),
      },
    };
  });

  app.post("/me/password", async (req, reply) => {
    const userId = req.auth?.sub;
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });
    const body = passwordChangeSchema.parse(req.body);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true },
    });
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    if (!verifyPassword(body.currentPassword, user.passwordHash)) {
      return reply.code(400).send({ error: "Current password is incorrect." });
    }
    if (body.currentPassword === body.newPassword) {
      return reply.code(400).send({ error: "New password must be different from the current password." });
    }
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: hashPassword(body.newPassword) },
    });
    return { ok: true };
  });

  app.get("/me/preferences", async (req, reply) => {
    const userId = req.auth?.sub;
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });
    const row = await prisma.userPreference.findUnique({ where: { userId } });
    let parsed: unknown = {};
    try {
      parsed = row?.settings ? JSON.parse(row.settings) : {};
    } catch {
      parsed = {};
    }
    const settings = sanitizeSettings(parsed);
    return { settings, updatedAt: row?.updatedAt?.toISOString() ?? null };
  });

  app.patch("/me/preferences", async (req, reply) => {
    const userId = req.auth?.sub;
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });
    const body = patchBodySchema.parse(req.body);
    const row = await prisma.userPreference.findUnique({ where: { userId } });
    let existingParsed: unknown = {};
    try {
      existingParsed = row?.settings ? JSON.parse(row.settings) : {};
    } catch {
      existingParsed = {};
    }
    const current = sanitizeSettings(existingParsed);
    const next = sanitizeSettings({ ...current, ...body.settings });
    const payload = JSON.stringify(next);
    const saved = await prisma.userPreference.upsert({
      where: { userId },
      create: { userId, settings: payload },
      update: { settings: payload },
    });
    let outParsed: unknown = {};
    try {
      outParsed = JSON.parse(saved.settings);
    } catch {
      outParsed = {};
    }
    return { settings: sanitizeSettings(outParsed), updatedAt: saved.updatedAt.toISOString() };
  });

  app.get("/me/dashboard", async (req, reply) => {
    const userId = req.auth?.sub;
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });
    if (!user) return reply.code(401).send({ error: "Unauthorized" });

    const prefRow = await prisma.userPreference.findUnique({ where: { userId } });
    let prefParsed: unknown = {};
    try {
      prefParsed = prefRow?.settings ? JSON.parse(prefRow.settings) : {};
    } catch {
      prefParsed = {};
    }
    const settings = sanitizeSettings(prefParsed);
    const orgId = req.auth?.orgId ?? null;
    const campaignFilter = orgId ? { organizationId: orgId } : { id: "__none__" };
    const attemptFilter = orgId ? { campaign: { organizationId: orgId } } : { id: "__none__" };

    const [
      campaigns,
      callDispositionGroups,
      smsStatusGroups,
      callTotal,
      smsTotal,
      contactTotal,
      recentCalls,
      recentSms,
      smsDuplicateSkipped,
      webhookEvents,
    ] = await Promise.all([
      prisma.campaign.findMany({
        where: campaignFilter,
        orderBy: { updatedAt: "desc" },
        take: 80,
        select: {
          id: true,
          name: true,
          kind: true,
          status: true,
          updatedAt: true,
          _count: { select: { contacts: true, callAttempts: true, smsAttempts: true } },
        },
      }),
      prisma.callAttempt.groupBy({
        by: ["disposition"],
        where: attemptFilter,
        _count: { _all: true },
      }),
      prisma.smsAttempt.groupBy({
        by: ["status"],
        where: attemptFilter,
        _count: { _all: true },
      }),
      prisma.callAttempt.count({ where: attemptFilter }),
      prisma.smsAttempt.count({ where: attemptFilter }),
      prisma.contact.count({
        where: orgId ? { campaign: { organizationId: orgId } } : { id: "__none__" },
      }),
      prisma.callAttempt.findMany({
        where: attemptFilter,
        orderBy: { createdAt: "desc" },
        take: 35,
        select: {
          id: true,
          disposition: true,
          createdAt: true,
          campaign: { select: { id: true, name: true, kind: true } },
          contact: { select: { phoneE164: true, name: true } },
        },
      }),
      prisma.smsAttempt.findMany({
        where: attemptFilter,
        orderBy: { createdAt: "desc" },
        take: 35,
        select: {
          id: true,
          status: true,
          body: true,
          rawPayload: true,
          createdAt: true,
          campaign: { select: { id: true, name: true, kind: true } },
          contact: { select: { phoneE164: true, name: true } },
        },
      }),
      // SQLite JsonFilter.path is a string (e.g. "$.reason"), not string[].
      prisma.smsAttempt.count({
        where: {
          ...attemptFilter,
          status: "FAILED",
          rawPayload: { path: "$.reason", equals: "DUPLICATE_WITHIN_WINDOW" },
        },
      }),
      prisma.webhookEvent.findMany({
        where: orgId ? { organizationId: orgId } : undefined,
        orderBy: { createdAt: "desc" },
        take: 25,
        select: { id: true, provider: true, type: true, createdAt: true },
      }),
    ]);

    const callsByDisposition = Object.fromEntries(
      callDispositionGroups.map((g) => [g.disposition, g._count._all]),
    ) as Record<string, number>;
    const smsByStatus = Object.fromEntries(smsStatusGroups.map((g) => [g.status, g._count._all])) as Record<
      string,
      number
    >;
    // Split duplicate-window skips out of FAILED so the dashboard does not call them failures.
    if (smsDuplicateSkipped > 0) {
      smsByStatus.FAILED = Math.max(0, (smsByStatus.FAILED ?? 0) - smsDuplicateSkipped);
      if (smsByStatus.FAILED === 0) delete smsByStatus.FAILED;
      smsByStatus.SKIPPED = (smsByStatus.SKIPPED ?? 0) + smsDuplicateSkipped;
    }

    const runningCampaigns = campaigns.filter((c) => c.status === "RUNNING").length;

    const smsStatusLabel = (s: { status: string; rawPayload: unknown }): string => {
      const reason =
        s.rawPayload && typeof s.rawPayload === "object" && s.rawPayload !== null && "reason" in s.rawPayload
          ? String((s.rawPayload as { reason?: unknown }).reason ?? "")
          : "";
      if (reason === "DUPLICATE_WITHIN_WINDOW") return "Skipped — already texted";
      if (reason === "DNC") return "Skipped — DNC";
      return s.status;
    };

    const activity = [
      ...recentCalls.map((c) => ({
        kind: "call" as const,
        id: c.id,
        at: c.createdAt.toISOString(),
        label: c.campaign.name,
        detail: `${c.disposition} · ${c.contact.phoneE164}${c.contact.name ? ` (${c.contact.name})` : ""}`,
        campaignId: c.campaign.id,
      })),
      ...recentSms.map((s) => ({
        kind: "sms" as const,
        id: s.id,
        at: s.createdAt.toISOString(),
        label: s.campaign.name,
        detail: `${smsStatusLabel(s)} · ${s.body.slice(0, 80)}${s.body.length > 80 ? "…" : ""}`,
        campaignId: s.campaign.id,
      })),
      ...webhookEvents.map((w) => ({
        kind: "webhook" as const,
        id: w.id,
        at: w.createdAt.toISOString(),
        label: `${w.provider} webhook`,
        detail: w.type,
        campaignId: null as string | null,
      })),
    ]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 60);

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: toPublicUserRole(user.role),
        memberSince: user.createdAt.toISOString(),
      },
      settings,
      summary: {
        campaignsTotal: campaigns.length,
        campaignsRunning: runningCampaigns,
        contactsTotal: contactTotal,
        callsTotal: callTotal,
        smsTotal: smsTotal,
      },
      callsByDisposition,
      smsByStatus,
      campaigns,
      activity,
      webhookEvents: webhookEvents.map((w) => ({
        id: w.id,
        at: w.createdAt.toISOString(),
        provider: w.provider,
        type: w.type,
      })),
    };
  });
}
