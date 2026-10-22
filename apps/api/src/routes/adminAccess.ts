import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  defaultPermissionsForOrgRole,
  functionPermissionPatchSchema,
  ORG_ROLES,
  SMS_PER_MINUTE_DEFAULT,
  smsPerMinuteSchema,
} from "@powerdialer/shared";
import { prisma } from "../db.js";
import { hashPassword } from "../auth.js";
import {
  isOrgAdminRole,
  isPlatformAdmin,
  requireOrg,
  requirePermission,
  resolvePermissions,
  writeAuditLog,
  type OrgAuth,
} from "../lib/orgAccess.js";

const patchSchema = z.object({
  permissions: functionPermissionPatchSchema,
  orgRole: z.enum(ORG_ROLES).optional(),
});

const inviteSchema = z.object({
  email: z.string().email(),
  orgRole: z.enum(ORG_ROLES).default("AGENT"),
});

const createMemberSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(200),
  orgRole: z.enum(ORG_ROLES).default("AGENT"),
  password: z.string().min(8).max(128).optional(),
});

const assignSchema = z.object({
  userIds: z.array(z.string().min(1)),
});

function requireOrgAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  const auth = req.auth as OrgAuth | null;
  if (isPlatformAdmin(auth) || isOrgAdminRole(auth?.orgRole)) return true;
  reply.code(403).send({ error: "Organization admin required." });
  return false;
}

export async function adminAccessRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/access/users", async (req, reply) => {
    const { isRbacEnforceAdminPerms } = await import("../rbac/enforceFlag.js");
    const { requirePermissionBatch1 } = await import("../rbac/permissionGate.js");
    const { teamUserIdsForActor } = await import("../rbac/teamScope.js");

    // E01: flag off → baseline requireOrgAdmin; flag on → members_manage + team filter.
    const auth = isRbacEnforceAdminPerms()
      ? await requirePermissionBatch1(req, reply, "members_manage", "GET /admin/access/users")
      : await requireOrg(req, reply);
    if (!auth) return;
    if (!isRbacEnforceAdminPerms()) {
      if (!requireOrgAdmin(req, reply)) return;
    }

    const teamIds = isRbacEnforceAdminPerms() ? await teamUserIdsForActor(auth) : ("all" as const);
    const members = await prisma.membership.findMany({
      where: {
        organizationId: auth.orgId,
        status: "ACTIVE",
        ...(teamIds === "all"
          ? {}
          : {
              OR: [{ userId: auth.sub }, { userId: { in: teamIds } }],
            }),
      },
      include: {
        user: { select: { id: true, name: true, email: true, role: true, createdAt: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    return {
      users: members.map((m) => ({
        id: m.user.id,
        membershipId: m.id,
        name: m.user.name,
        email: m.user.email,
        role: m.user.role === "OWNER" ? "owner" : m.user.role === "ADMIN" ? "admin" : "user",
        orgRole: m.orgRole,
        createdAt: m.user.createdAt.toISOString(),
        permissions: resolvePermissions(m.orgRole, m.permissions),
      })),
    };
  });

  app.patch("/admin/access/users/:id", async (req, reply) => {
    const { isRbacEnforceAdminPerms } = await import("../rbac/enforceFlag.js");
    const { denyWithAudit, requirePermissionBatch1 } = await import("../rbac/permissionGate.js");
    // Batch 4-prep-0: re-key to members_change_role (Owner-only when enforce on).
    const auth = isRbacEnforceAdminPerms()
      ? await requirePermissionBatch1(req, reply, "members_change_role", "PATCH /admin/access/users/:id")
      : await requirePermission(req, reply, "members_manage");
    if (!auth) return;
    const id = (req.params as { id: string }).id;
    const body = patchSchema.parse(req.body);
    const membership = await prisma.membership.findUnique({
      where: { userId_organizationId: { userId: id, organizationId: auth.orgId } },
      include: { user: { select: { role: true } } },
    });
    if (!membership) return reply.code(404).send({ error: "Member not found" });
    if (membership.orgRole === "ORG_OWNER" && auth.orgRole !== "ORG_OWNER" && !isPlatformAdmin(auth)) {
      return reply.code(400).send({ error: "Only an org owner can edit another owner." });
    }

    // Privilege-escalation guards (always): no self-promote to Owner; only Owner may set ORG_OWNER.
    if (body.orgRole === "ORG_OWNER") {
      if (id === auth.sub || auth.orgRole !== "ORG_OWNER") {
        if (isRbacEnforceAdminPerms()) {
          await denyWithAudit(reply, auth, {
            path: "PATCH /admin/access/users/:id",
            requiredPermission: "members_change_role",
            reason: "role_escalation",
          });
          return;
        }
        return reply.code(403).send({ error: "Only an org owner can grant owner role." });
      }
    }
    if (isRbacEnforceAdminPerms() && auth.orgRole !== "ORG_OWNER" && body.orgRole) {
      await denyWithAudit(reply, auth, {
        path: "PATCH /admin/access/users/:id",
        requiredPermission: "members_change_role",
        reason: "role_escalation",
      });
      return;
    }

    const current = resolvePermissions(membership.orgRole, membership.permissions);
    const merged = { ...current, ...body.permissions };
    const updated = await prisma.membership.update({
      where: { id: membership.id },
      data: {
        permissions: JSON.stringify(merged),
        ...(body.orgRole ? { orgRole: body.orgRole } : {}),
      },
    });
    await writeAuditLog({
      organizationId: auth.orgId,
      actorUserId: auth.sub,
      action: "members.permissions_updated",
      entityType: "Membership",
      entityId: updated.id,
      meta: { userId: id, orgRole: updated.orgRole },
    });
    return {
      ok: true,
      userId: id,
      orgRole: updated.orgRole,
      permissions: resolvePermissions(updated.orgRole, updated.permissions),
    };
  });

  async function seatLimitReached(orgId: string): Promise<number | null> {
    const sub = await prisma.subscription.findUnique({
      where: { organizationId: orgId },
      include: { plan: true },
    });
    const seatLimit = sub?.plan.seatLimit ?? 25;
    const seatCount = await prisma.membership.count({
      where: { organizationId: orgId, status: "ACTIVE" },
    });
    return seatCount >= seatLimit ? seatLimit : null;
  }

  /** Create an employee / member account directly under the company (no invite email needed). */
  app.post("/org/members", async (req, reply) => {
    const { isRbacEnforceAdminPerms } = await import("../rbac/enforceFlag.js");
    const { requirePermissionBatch1 } = await import("../rbac/permissionGate.js");
    // Batch 3: re-key to members_invite (Owner-only when enforce on).
    const auth = isRbacEnforceAdminPerms()
      ? await requirePermissionBatch1(req, reply, "members_invite", "POST /org/members")
      : await requirePermission(req, reply, "members_manage");
    if (!auth) return;
    const body = createMemberSchema.parse(req.body);
    const email = body.email.toLowerCase();
    if (body.orgRole === "ORG_OWNER" && auth.orgRole !== "ORG_OWNER" && !isPlatformAdmin(auth)) {
      return reply.code(403).send({ error: "Only an org owner can add another owner." });
    }

    const limit = await seatLimitReached(auth.orgId);
    if (limit != null) {
      return reply.code(402).send({
        error: `Seat limit reached (${limit}). Upgrade your plan to add more people.`,
      });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      const existingMembership = await prisma.membership.findUnique({
        where: { userId_organizationId: { userId: existingUser.id, organizationId: auth.orgId } },
      });
      if (existingMembership && existingMembership.status === "ACTIVE") {
        return reply.code(409).send({ error: "This person is already a member of your company." });
      }
      const otherOrg = await prisma.membership.findFirst({
        where: { userId: existingUser.id, organizationId: { not: auth.orgId }, status: "ACTIVE" },
      });
      if (otherOrg) {
        return reply.code(409).send({
          error: "That email already belongs to another company. Ask them to use a different address.",
        });
      }
    }

    const tempPassword = body.password ?? `${randomBytes(6).toString("base64url")}Aa1!`;
    const user =
      existingUser ??
      (await prisma.user.create({
        data: {
          name: body.name,
          email,
          passwordHash: hashPassword(tempPassword),
          role: "USER",
        },
      }));

    const membership = await prisma.membership.upsert({
      where: { userId_organizationId: { userId: user.id, organizationId: auth.orgId } },
      create: {
        userId: user.id,
        organizationId: auth.orgId,
        orgRole: body.orgRole,
        status: "ACTIVE",
        permissions: JSON.stringify(defaultPermissionsForOrgRole(body.orgRole)),
      },
      update: { orgRole: body.orgRole, status: "ACTIVE" },
    });

    await writeAuditLog({
      organizationId: auth.orgId,
      actorUserId: auth.sub,
      action: "members.created",
      entityType: "Membership",
      entityId: membership.id,
      meta: { email, orgRole: body.orgRole },
    });

    return reply.code(201).send({
      id: user.id,
      membershipId: membership.id,
      name: user.name,
      email: user.email,
      orgRole: membership.orgRole,
      // Returned once so the admin can hand it to the employee.
      temporaryPassword: existingUser ? null : tempPassword,
    });
  });

  /** Remove a member from the company (keeps the user account; disables membership). */
  app.delete("/org/members/:id", async (req, reply) => {
    const { isRbacEnforceAdminPerms } = await import("../rbac/enforceFlag.js");
    const { denyWithAudit, requirePermissionBatch1 } = await import("../rbac/permissionGate.js");
    // Prep-0b: members_change_role + C3 reassignment when demoting/removing an Admin with a team.
    const auth = isRbacEnforceAdminPerms()
      ? await requirePermissionBatch1(req, reply, "members_change_role", "DELETE /org/members/:id")
      : await requirePermission(req, reply, "members_manage");
    if (!auth) return;
    const id = (req.params as { id: string }).id;
    if (id === auth.sub) {
      if (isRbacEnforceAdminPerms()) {
        await denyWithAudit(reply, auth, {
          path: "DELETE /org/members/:id",
          requiredPermission: "members_change_role",
          reason: "self_demote_blocked",
        });
        return;
      }
      return reply.code(400).send({ error: "You cannot remove yourself." });
    }
    const membership = await prisma.membership.findUnique({
      where: { userId_organizationId: { userId: id, organizationId: auth.orgId } },
    });
    if (!membership) return reply.code(404).send({ error: "Member not found" });
    if (membership.orgRole === "ORG_OWNER" && auth.orgRole !== "ORG_OWNER" && !isPlatformAdmin(auth)) {
      return reply.code(403).send({ error: "Only an org owner can remove another owner." });
    }

    const demoteBody = z
      .object({
        reassignments: z
          .array(
            z.object({
              userId: z.string().min(1),
              /** null = Owner-direct; otherwise target Admin's userId */
              newManagerId: z.string().min(1).nullable(),
            }),
          )
          .optional(),
      })
      .safeParse(req.body ?? {});
    const reassignments = demoteBody.success ? demoteBody.data.reassignments ?? [] : [];

    const teamMembers = await prisma.membership.findMany({
      where: {
        organizationId: auth.orgId,
        status: "ACTIVE",
        managedByAdminId: membership.id,
      },
      select: { id: true, userId: true },
    });
    const previousTeamSize = teamMembers.length;
    const isAdminTarget = membership.orgRole === "ORG_ADMIN";

    if (isRbacEnforceAdminPerms() && isAdminTarget && previousTeamSize > 0) {
      if (reassignments.length === 0) {
        return reply.code(400).send({
          error:
            "Demotion requires reassignment. Choose another Admin or accept reassignment to yourself.",
        });
      }
      const teamUserIds = new Set(teamMembers.map((t) => t.userId));
      const covered = new Set(reassignments.map((r) => r.userId));
      if (covered.size !== teamUserIds.size || [...teamUserIds].some((u) => !covered.has(u))) {
        return reply.code(400).send({
          error:
            "Demotion requires reassignment. Choose another Admin or accept reassignment to yourself.",
        });
      }
      // Resolve newManagerId (userId) → membershipId; null = Owner-direct
      const resolved: Array<{ userId: string; previousManagerId: string; newManagerId: string | null; newMembershipId: string | null }> = [];
      for (const r of reassignments) {
        if (r.newManagerId === null) {
          resolved.push({
            userId: r.userId,
            previousManagerId: id,
            newManagerId: null,
            newMembershipId: null,
          });
          continue;
        }
        if (r.newManagerId === id) {
          return reply.code(400).send({ error: "Cannot reassign to the Admin being removed." });
        }
        const targetMgr = await prisma.membership.findFirst({
          where: {
            organizationId: auth.orgId,
            userId: r.newManagerId,
            orgRole: "ORG_ADMIN",
            status: "ACTIVE",
          },
          select: { id: true, userId: true },
        });
        if (!targetMgr) {
          return reply.code(400).send({
            error:
              "Demotion requires reassignment. Choose another Admin or accept reassignment to yourself.",
          });
        }
        resolved.push({
          userId: r.userId,
          previousManagerId: id,
          newManagerId: targetMgr.userId,
          newMembershipId: targetMgr.id,
        });
      }

      try {
        await prisma.$transaction(async (tx) => {
          for (const r of resolved) {
            await tx.membership.updateMany({
              where: { organizationId: auth.orgId, userId: r.userId, status: "ACTIVE" },
              data: { managedByAdminId: r.newMembershipId },
            });
          }
          await tx.campaign.updateMany({
            where: { organizationId: auth.orgId, startedByUserId: id },
            data: { startedByUserId: auth.sub },
          });
          await tx.membership.update({
            where: { id: membership.id },
            data: { status: "DISABLED", orgRole: "AGENT" },
          });
          await tx.campaignAssignment.deleteMany({
            where: { userId: id, campaign: { organizationId: auth.orgId } },
          });
        });
      } catch {
        return reply.code(500).send({ error: "Demotion failed; no changes applied." });
      }

      await writeAuditLog({
        organizationId: auth.orgId,
        actorUserId: auth.sub,
        action: "members.admin_demoted",
        entityType: "Membership",
        entityId: membership.id,
        meta: {
          event: "members.admin_demoted",
          actorId: auth.sub,
          demotedAdminId: id,
          reassignments: resolved.map((r) => ({
            userId: r.userId,
            previousManagerId: r.previousManagerId,
            newManagerId: r.newManagerId,
          })),
          previousTeamSize,
          newTeamSize: 0,
          timestamp: new Date().toISOString(),
        },
      });
      return { ok: true, demoted: true, previousTeamSize, newTeamSize: 0 };
    }

    // Non-Admin target, or Admin with empty team / flag off
    await prisma.$transaction([
      prisma.membership.update({ where: { id: membership.id }, data: { status: "DISABLED" } }),
      prisma.campaignAssignment.deleteMany({
        where: { userId: id, campaign: { organizationId: auth.orgId } },
      }),
    ]);
    await writeAuditLog({
      organizationId: auth.orgId,
      actorUserId: auth.sub,
      action: "members.removed",
      entityType: "Membership",
      entityId: membership.id,
      meta: { userId: id },
    });
    return { ok: true };
  });

  app.post("/org/invites", async (req, reply) => {
    const { isRbacEnforceAdminPerms } = await import("../rbac/enforceFlag.js");
    const { requirePermissionBatch1 } = await import("../rbac/permissionGate.js");
    // Batch 3: re-key to members_invite (Owner-only when enforce on).
    const auth = isRbacEnforceAdminPerms()
      ? await requirePermissionBatch1(req, reply, "members_invite", "POST /org/invites")
      : await requirePermission(req, reply, "members_manage");
    if (!auth) return;
    const body = inviteSchema.parse(req.body);
    const email = body.email.toLowerCase();

    const limit = await seatLimitReached(auth.orgId);
    if (limit != null) {
      return reply.code(402).send({
        error: `Seat limit reached (${limit}). Upgrade your plan to invite more users.`,
      });
    }

    const token = randomBytes(24).toString("hex");
    const invite = await prisma.invitation.create({
      data: {
        organizationId: auth.orgId,
        email,
        orgRole: body.orgRole,
        token,
        invitedById: auth.sub,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    await writeAuditLog({
      organizationId: auth.orgId,
      actorUserId: auth.sub,
      action: "invite.created",
      entityType: "Invitation",
      entityId: invite.id,
      meta: { email, orgRole: body.orgRole },
    });
    return {
      id: invite.id,
      email: invite.email,
      orgRole: invite.orgRole,
      token: invite.token,
      acceptPath: `/accept-invite?token=${invite.token}`,
      expiresAt: invite.expiresAt.toISOString(),
    };
  });

  app.get("/org/invites", async (req, reply) => {
    const { isRbacEnforceAdminPerms } = await import("../rbac/enforceFlag.js");
    const { requirePermissionBatch1 } = await import("../rbac/permissionGate.js");
    // Batch 3: re-key to members_invite (Owner-only when enforce on).
    const auth = isRbacEnforceAdminPerms()
      ? await requirePermissionBatch1(req, reply, "members_invite", "GET /org/invites")
      : await requirePermission(req, reply, "members_manage");
    if (!auth) return;
    const rows = await prisma.invitation.findMany({
      where: { organizationId: auth.orgId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return { invites: rows };
  });

  app.get("/org/settings", async (req, reply) => {
    const auth = await requireOrg(req, reply);
    if (!auth) return;
    const { shapeOrgSettingsForRole } = await import("../rbac/orgSettingsShape.js");
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: auth.orgId },
      include: {
        integrationPreference: true,
        plan: true,
        subscription: true,
      },
    });
    let settings: Record<string, unknown> = {};
    try {
      settings = JSON.parse(org.settings) as Record<string, unknown>;
    } catch {
      settings = {};
    }
    const full = {
      id: org.id,
      name: org.name,
      slug: org.slug,
      settings,
      smsPerMinute: org.integrationPreference?.smsPerMinute ?? SMS_PER_MINUTE_DEFAULT,
      preferredIntegrationKey: org.integrationPreference?.preferredIntegrationKey ?? "twilio",
      plan: org.plan
        ? { name: org.plan.name, slug: org.plan.slug, seatLimit: org.plan.seatLimit }
        : null,
      subscription: org.subscription
        ? { status: org.subscription.status, currentPeriodEnd: org.subscription.currentPeriodEnd }
        : null,
    };
    return shapeOrgSettingsForRole(full, auth.orgRole);
  });

  app.patch("/org/settings", async (req, reply) => {
    const { isRbacEnforceAdminPerms } = await import("../rbac/enforceFlag.js");
    const { requirePermissionBatch1 } = await import("../rbac/permissionGate.js");
    // Bucket B / prep-2: company_settings Owner-only when enforce on (Admin 403).
    const auth = isRbacEnforceAdminPerms()
      ? await requirePermissionBatch1(req, reply, "company_settings", "PATCH /org/settings")
      : await requirePermission(req, reply, "company_settings");
    if (!auth) return;
    const body = z
      .object({
        name: z.string().trim().min(2).max(120).optional(),
        settings: z.record(z.unknown()).optional(),
        smsPerMinute: smsPerMinuteSchema.optional(),
      })
      .parse(req.body);

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: auth.orgId } });
    let settings: Record<string, unknown> = {};
    try {
      settings = JSON.parse(org.settings) as Record<string, unknown>;
    } catch {
      settings = {};
    }
    if (body.settings) settings = { ...settings, ...body.settings };

    await prisma.organization.update({
      where: { id: auth.orgId },
      data: {
        ...(body.name ? { name: body.name } : {}),
        settings: JSON.stringify(settings),
      },
    });
    if (body.smsPerMinute != null) {
      await prisma.integrationPreference.upsert({
        where: { organizationId: auth.orgId },
        create: {
          organizationId: auth.orgId,
          preferredIntegrationKey: "twilio",
          smsPerMinute: body.smsPerMinute,
        },
        update: { smsPerMinute: body.smsPerMinute },
      });
    }
    await writeAuditLog({
      organizationId: auth.orgId,
      actorUserId: auth.sub,
      action: "org.settings_updated",
      entityType: "Organization",
      entityId: auth.orgId,
    });
    return { ok: true };
  });

  app.get("/org/billing", async (req, reply) => {
    const { isRbacEnforceAdminPerms } = await import("../rbac/enforceFlag.js");
    const { requirePermissionBatch1 } = await import("../rbac/permissionGate.js");
    // Bucket B / prep-2: billing_view Owner-only when enforce on.
    const auth = isRbacEnforceAdminPerms()
      ? await requirePermissionBatch1(req, reply, "billing_view", "GET /org/billing")
      : await requirePermission(req, reply, "billing_view");
    if (!auth) return;
    const sub = await prisma.subscription.findUnique({
      where: { organizationId: auth.orgId },
      include: { plan: true },
    });
    const seats = await prisma.membership.count({
      where: { organizationId: auth.orgId, status: "ACTIVE" },
    });
    return {
      subscription: sub
        ? {
            status: sub.status,
            plan: sub.plan,
            stripeCustomerId: sub.stripeCustomerId,
            currentPeriodEnd: sub.currentPeriodEnd,
          }
        : null,
      seatsUsed: seats,
      seatLimit: sub?.plan.seatLimit ?? 5,
      stripeCheckoutEnabled: false,
      message: "Manual billing — contact sales@derivedstudio.com. Plan limits are enforced in this workspace.",
    };
  });

  app.get("/org/audit-logs", async (req, reply) => {
    const { isRbacEnforceAdminPerms } = await import("../rbac/enforceFlag.js");
    const { requirePermissionBatch1 } = await import("../rbac/permissionGate.js");
    const { teamUserIdsForActor } = await import("../rbac/teamScope.js");
    // D7: audit_view + actor-OR-target team filter when enforce on.
    const auth = isRbacEnforceAdminPerms()
      ? await requirePermissionBatch1(req, reply, "audit_view", "GET /org/audit-logs")
      : await requirePermission(req, reply, "members_manage");
    if (!auth) return;

    let rows = await prisma.auditLog.findMany({
      where: { organizationId: auth.orgId },
      orderBy: { createdAt: "desc" },
      take: 500,
    });

    if (isRbacEnforceAdminPerms() && auth.orgRole === "ORG_ADMIN") {
      const teamIds = await teamUserIdsForActor(
        auth as Parameters<typeof teamUserIdsForActor>[0],
      );
      const allowed = new Set(
        Array.isArray(teamIds) ? [...teamIds, auth.sub] : [],
      );
      rows = rows.filter((r) => {
        if (r.actorUserId && allowed.has(r.actorUserId)) return true;
        try {
          const meta = JSON.parse(r.meta) as {
            targetUserId?: string;
            userId?: string;
            demotedAdminId?: string;
          };
          const target = meta.targetUserId ?? meta.userId ?? meta.demotedAdminId;
          if (target && allowed.has(target)) return true;
        } catch {
          /* ignore */
        }
        return false;
      });
    }

    return {
      logs: rows.slice(0, 200).map((r) => ({
        ...r,
        meta: (() => {
          try {
            return JSON.parse(r.meta);
          } catch {
            return {};
          }
        })(),
      })),
    };
  });

  app.get("/campaigns/:id/assignments", async (req, reply) => {
    const { isRbacEnforceAdminPerms } = await import("../rbac/enforceFlag.js");
    const { denyWithAudit, requirePermissionBatch1 } = await import("../rbac/permissionGate.js");
    const { isCampaignOwnedByActor } = await import("../rbac/teamScope.js");

    // E02: flag off → baseline requireOrgAdmin; flag on → members_manage + owned campaign.
    const auth = isRbacEnforceAdminPerms()
      ? await requirePermissionBatch1(req, reply, "members_manage", "GET /campaigns/:id/assignments")
      : await requireOrg(req, reply);
    if (!auth) return;
    if (!isRbacEnforceAdminPerms()) {
      if (!requireOrgAdmin(req, reply)) return;
    }

    const id = (req.params as { id: string }).id;
    const campaign = await prisma.campaign.findFirst({
      where: { id, organizationId: auth.orgId },
      select: { id: true, startedByUserId: true },
    });
    if (!campaign) return reply.code(404).send({ error: "Not found" });

    if (isRbacEnforceAdminPerms() && auth.orgRole === "ORG_ADMIN") {
      const owned = await isCampaignOwnedByActor(auth, campaign);
      if (!owned) {
        await denyWithAudit(reply, auth, {
          path: "GET /campaigns/:id/assignments",
          requiredPermission: "members_manage",
          reason: "cross_team_campaign",
        });
        return;
      }
    }

    const rows = await prisma.campaignAssignment.findMany({
      where: { campaignId: id },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    return { assignments: rows.map((r) => ({ userId: r.userId, user: r.user, createdAt: r.createdAt })) };
  });

  app.put("/campaigns/:id/assignments", async (req, reply) => {
    const { isRbacEnforceAdminPerms } = await import("../rbac/enforceFlag.js");
    const { requirePermissionBatch1 } = await import("../rbac/permissionGate.js");
    const { loadCampaignIfAccessible } = await import("../rbac/campaignAccess.js");
    const id = (req.params as { id: string }).id;
    const auth = isRbacEnforceAdminPerms()
      ? await requirePermissionBatch1(req, reply, "members_manage", "PUT /campaigns/:id/assignments")
      : await requirePermission(req, reply, "members_manage");
    if (!auth) return;
    if (isRbacEnforceAdminPerms()) {
      if (
        !(await loadCampaignIfAccessible(
          reply,
          auth as Parameters<typeof loadCampaignIfAccessible>[1],
          id,
          "PUT /campaigns/:id/assignments",
          "members_manage",
        ))
      ) {
        return;
      }
    }
    const body = assignSchema.parse(req.body);
    const campaign = await prisma.campaign.findFirst({
      where: { id, organizationId: auth.orgId },
      select: { id: true },
    });
    if (!campaign) return reply.code(404).send({ error: "Not found" });

    await prisma.$transaction(async (tx) => {
      await tx.campaignAssignment.deleteMany({ where: { campaignId: id } });
      if (body.userIds.length) {
        await tx.campaignAssignment.createMany({
          data: body.userIds.map((userId) => ({ campaignId: id, userId })),
        });
      }
    });
    await writeAuditLog({
      organizationId: auth.orgId,
      actorUserId: auth.sub,
      action: "campaign.assignments_updated",
      entityType: "Campaign",
      entityId: id,
      meta: { userIds: body.userIds },
    });
    return { ok: true, userIds: body.userIds };
  });
}
