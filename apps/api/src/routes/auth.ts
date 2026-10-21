import type { FastifyInstance } from "fastify";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  defaultPermissionsForOrgRole,
  type OrgRolePublic,
} from "@powerdialer/shared";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { hashPassword, issueAuthToken, verifyPassword } from "../auth.js";
import {
  resolvePermissions,
  uniqueOrgSlug,
  writeAuditLog,
} from "../lib/orgAccess.js";

function toPublicRole(role: "USER" | "ADMIN" | "OWNER"): "user" | "admin" | "owner" {
  if (role === "OWNER") return "owner";
  return role === "ADMIN" ? "admin" : "user";
}

async function primaryMembership(userId: string) {
  return prisma.membership.findFirst({
    where: { userId, status: "ACTIVE" },
    include: { organization: { select: { id: true, name: true, slug: true } } },
    orderBy: { createdAt: "asc" },
  });
}

async function tokenForUser(user: {
  id: string;
  name: string;
  email: string;
  role: "USER" | "ADMIN" | "OWNER";
  tokenVersion: number;
}) {
  const membership = await primaryMembership(user.id);
  return issueAuthToken({
    userId: user.id,
    role: toPublicRole(user.role),
    email: user.email,
    name: user.name,
    orgId: membership?.organizationId ?? null,
    orgRole: (membership?.orgRole as OrgRolePublic | undefined) ?? null,
    membershipId: membership?.id ?? null,
    tokenVersion: user.tokenVersion,
  });
}

function publicUser(user: {
  id: string;
  name: string;
  email: string;
  role: "USER" | "ADMIN" | "OWNER";
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: toPublicRole(user.role),
  };
}

const registerCompanySchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(200),
  password: z.string().min(8).max(128),
  companyName: z.string().trim().min(2).max(120),
});

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(200),
  password: z.string().min(8).max(128),
  adminCode: z.string().optional(),
  companyName: z.string().trim().min(2).max(120).optional(),
});

const loginSchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(128),
});

const acceptInviteSchema = z.object({
  token: z.string().min(10),
  name: z.string().trim().min(2).max(80).optional(),
  password: z.string().min(8).max(128).optional(),
});

const passwordResetRequestSchema = z.object({
  email: z.string().trim().email(),
});

const passwordResetConfirmSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(8).max(128),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get("/auth/me", async (req, reply) => {
    if (!req.auth?.sub) return reply.code(401).send({ error: "Unauthorized" });
    const user = await prisma.user.findUnique({
      where: { id: req.auth.sub },
      select: { id: true, name: true, email: true, role: true, tokenVersion: true },
    });
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    if ((req.auth.tokenVersion ?? 0) !== user.tokenVersion) {
      return reply.code(401).send({ error: "Session expired" });
    }
    const membership = await primaryMembership(user.id);
    const permissions = resolvePermissions(
      (membership?.orgRole as OrgRolePublic | undefined) ?? null,
      membership?.permissions,
    );
    return {
      user: publicUser(user),
      organization: membership
        ? {
            id: membership.organization.id,
            name: membership.organization.name,
            slug: membership.organization.slug,
            orgRole: membership.orgRole,
            membershipId: membership.id,
          }
        : null,
      permissions,
    };
  });

  app.post("/auth/register-company", async (req, reply) => {
    const body = registerCompanySchema.parse(req.body);
    const email = body.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return reply.code(409).send({ error: "Email is already registered." });

    const slug = await uniqueOrgSlug(body.companyName);
    const plan = await prisma.plan.upsert({
      where: { slug: "starter" },
      create: {
        name: "Starter",
        slug: "starter",
        seatLimit: 25,
        smsMonthlyCap: 50_000,
        priceCents: 0,
      },
      update: {},
    });

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: body.name,
          email,
          passwordHash: hashPassword(body.password),
          role: "USER",
        },
      });
      const org = await tx.organization.create({
        data: {
          name: body.companyName,
          slug,
          planId: plan.id,
          settings: JSON.stringify({ timezone: "UTC" }),
        },
      });
      await tx.subscription.create({
        data: { organizationId: org.id, planId: plan.id, status: "TRIALING" },
      });
      await tx.integrationPreference.create({
        data: { organizationId: org.id, preferredIntegrationKey: "twilio", smsPerMinute: 30 },
      });
      const membership = await tx.membership.create({
        data: {
          userId: user.id,
          organizationId: org.id,
          orgRole: "ORG_OWNER",
          status: "ACTIVE",
          permissions: JSON.stringify(defaultPermissionsForOrgRole("ORG_OWNER")),
        },
      });
      return { user, org, membership };
    });

    await writeAuditLog({
      organizationId: result.org.id,
      actorUserId: result.user.id,
      action: "org.created",
      entityType: "Organization",
      entityId: result.org.id,
    });

    const token = await tokenForUser({ ...result.user, tokenVersion: 0 });
    return reply.code(201).send({
      token,
      user: publicUser(result.user),
      organization: {
        id: result.org.id,
        name: result.org.name,
        slug: result.org.slug,
        orgRole: "ORG_OWNER",
        membershipId: result.membership.id,
      },
    });
  });

  app.post("/auth/register", async (req, reply) => {
    const body = registerSchema.parse(req.body);
    if (body.companyName?.trim()) {
      req.body = {
        name: body.name,
        email: body.email,
        password: body.password,
        companyName: body.companyName,
      };
      // Fall through to company registration handler by re-invoking schema path inline.
      const companyBody = registerCompanySchema.parse(req.body);
      const email = companyBody.email.toLowerCase();
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) return reply.code(409).send({ error: "Email is already registered." });
      const slug = await uniqueOrgSlug(companyBody.companyName);
      const plan = await prisma.plan.upsert({
        where: { slug: "starter" },
        create: {
          name: "Starter",
          slug: "starter",
          seatLimit: 25,
          smsMonthlyCap: 50_000,
          priceCents: 0,
        },
        update: {},
      });
      const result = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            name: companyBody.name,
            email,
            passwordHash: hashPassword(companyBody.password),
            role: "USER",
          },
        });
        const org = await tx.organization.create({
          data: {
            name: companyBody.companyName,
            slug,
            planId: plan.id,
            settings: JSON.stringify({ timezone: "UTC" }),
          },
        });
        await tx.subscription.create({
          data: { organizationId: org.id, planId: plan.id, status: "TRIALING" },
        });
        await tx.integrationPreference.create({
          data: { organizationId: org.id, preferredIntegrationKey: "twilio", smsPerMinute: 30 },
        });
        const membership = await tx.membership.create({
          data: {
            userId: user.id,
            organizationId: org.id,
            orgRole: "ORG_OWNER",
            status: "ACTIVE",
            permissions: JSON.stringify(defaultPermissionsForOrgRole("ORG_OWNER")),
          },
        });
        return { user, org, membership };
      });
      const token = await tokenForUser({ ...result.user, tokenVersion: 0 });
      return reply.code(201).send({
        token,
        user: publicUser(result.user),
        organization: {
          id: result.org.id,
          name: result.org.name,
          slug: result.org.slug,
          orgRole: "ORG_OWNER",
          membershipId: result.membership.id,
        },
      });
    }

    const email = body.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return reply.code(409).send({ error: "Email is already registered." });

    const wantsAdmin = Boolean(body.adminCode?.trim().length);
    const role =
      wantsAdmin && body.adminCode === env.ADMIN_REGISTRATION_CODE ? "ADMIN" : "USER";
    if (wantsAdmin && role !== "ADMIN") {
      return reply.code(403).send({ error: "Invalid admin registration code." });
    }

    const defaultOrg = await prisma.organization.findUnique({
      where: { slug: "default-workspace" },
    });

    const user = await prisma.user.create({
      data: {
        name: body.name,
        email,
        passwordHash: hashPassword(body.password),
        role,
      },
    });

    if (defaultOrg) {
      await prisma.membership.create({
        data: {
          userId: user.id,
          organizationId: defaultOrg.id,
          orgRole: role === "ADMIN" ? "ORG_ADMIN" : "AGENT",
          status: "ACTIVE",
          permissions: JSON.stringify(
            defaultPermissionsForOrgRole(role === "ADMIN" ? "ORG_ADMIN" : "AGENT"),
          ),
        },
      });
    }

    const token = await tokenForUser({ ...user, tokenVersion: 0 });
    const membership = await primaryMembership(user.id);
    return reply.code(201).send({
      token,
      user: publicUser(user),
      organization: membership
        ? {
            id: membership.organization.id,
            name: membership.organization.name,
            slug: membership.organization.slug,
            orgRole: membership.orgRole,
            membershipId: membership.id,
          }
        : null,
    });
  });

  app.post("/auth/login", async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const email = body.email.toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !verifyPassword(body.password, user.passwordHash)) {
      return reply.code(401).send({ error: "Invalid email or password." });
    }
    const token = await tokenForUser(user);
    const membership = await primaryMembership(user.id);
    const permissions = resolvePermissions(
      (membership?.orgRole as OrgRolePublic | undefined) ?? null,
      membership?.permissions,
    );
    // Don't block the login response on audit I/O — sign-in INP is scrypt-bound already
    void writeAuditLog({
      organizationId: membership?.organizationId,
      actorUserId: user.id,
      action: "auth.login",
      entityType: "User",
      entityId: user.id,
    });
    return {
      token,
      user: publicUser(user),
      organization: membership
        ? {
            id: membership.organization.id,
            name: membership.organization.name,
            slug: membership.organization.slug,
            orgRole: membership.orgRole,
            membershipId: membership.id,
          }
        : null,
      permissions,
    };
  });

  app.post("/auth/logout", async (req) => {
    if (req.auth?.sub) {
      await prisma.user.update({
        where: { id: req.auth.sub },
        data: { tokenVersion: { increment: 1 } },
      });
    }
    return { ok: true };
  });

  app.post("/auth/accept-invite", async (req, reply) => {
    const body = acceptInviteSchema.parse(req.body);
    const invite = await prisma.invitation.findUnique({ where: { token: body.token } });
    if (!invite || invite.status !== "PENDING") {
      return reply.code(400).send({ error: "Invalid or used invitation." });
    }
    if (invite.expiresAt.getTime() < Date.now()) {
      await prisma.invitation.update({
        where: { id: invite.id },
        data: { status: "EXPIRED" },
      });
      return reply.code(400).send({ error: "Invitation expired." });
    }

    const email = invite.email.toLowerCase();
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      if (!body.password || !body.name) {
        return reply.code(400).send({ error: "Name and password required for new accounts." });
      }
      user = await prisma.user.create({
        data: {
          name: body.name,
          email,
          passwordHash: hashPassword(body.password),
          role: "USER",
        },
      });
    }

    const membership = await prisma.membership.upsert({
      where: {
        userId_organizationId: { userId: user.id, organizationId: invite.organizationId },
      },
      create: {
        userId: user.id,
        organizationId: invite.organizationId,
        orgRole: invite.orgRole,
        status: "ACTIVE",
        permissions: JSON.stringify(defaultPermissionsForOrgRole(invite.orgRole)),
      },
      update: {
        orgRole: invite.orgRole,
        status: "ACTIVE",
      },
    });

    await prisma.invitation.update({
      where: { id: invite.id },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
    });

    await writeAuditLog({
      organizationId: invite.organizationId,
      actorUserId: user.id,
      action: "invite.accepted",
      entityType: "Invitation",
      entityId: invite.id,
    });

    const token = await tokenForUser(user);
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: invite.organizationId },
    });
    return {
      token,
      user: publicUser(user),
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        orgRole: membership.orgRole,
        membershipId: membership.id,
      },
    };
  });

  app.post("/auth/password-reset/request", async (req, _reply) => {
    const body = passwordResetRequestSchema.parse(req.body);
    const email = body.email.toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
    // Always OK to avoid email enumeration.
    if (user) {
      const token = randomBytes(32).toString("hex");
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          token: createHash("sha256").update(token).digest("hex"),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
      // Demo: return token so local operators can reset without email delivery.
      if (env.DEMO_MODE || env.NODE_ENV !== "production") {
        return { ok: true, resetToken: token };
      }
    }
    return { ok: true };
  });

  app.post("/auth/password-reset/confirm", async (req, reply) => {
    const body = passwordResetConfirmSchema.parse(req.body);
    const hashed = createHash("sha256").update(body.token).digest("hex");
    const row = await prisma.passwordResetToken.findUnique({ where: { token: hashed } });
    if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) {
      return reply.code(400).send({ error: "Invalid or expired reset token." });
    }
    await prisma.$transaction([
      prisma.user.update({
        where: { id: row.userId },
        data: {
          passwordHash: hashPassword(body.password),
          tokenVersion: { increment: 1 },
        },
      }),
      prisma.passwordResetToken.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      }),
    ]);
    return { ok: true };
  });

  app.get("/auth/google", async (_req, reply) => {
    if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_REDIRECT_URI) {
      return reply.code(501).send({
        error: "Google OAuth is not configured. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_REDIRECT_URI.",
      });
    }
    const params = new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI,
      response_type: "code",
      scope: "openid email profile",
      access_type: "online",
      prompt: "select_account",
    });
    return reply.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  app.get("/auth/google/callback", async (req, reply) => {
    if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET || !env.GOOGLE_OAUTH_REDIRECT_URI) {
      return reply.code(501).send({ error: "Google OAuth is not configured." });
    }
    const q = z.object({ code: z.string() }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "Missing code" });

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: q.data.code,
        client_id: env.GOOGLE_OAUTH_CLIENT_ID,
        client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
        redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) {
      return reply.code(400).send({ error: "Google token exchange failed" });
    }
    const tokens = (await tokenRes.json()) as { access_token?: string };
    if (!tokens.access_token) return reply.code(400).send({ error: "No access token" });

    const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    if (!profileRes.ok) return reply.code(400).send({ error: "Failed to load Google profile" });
    const profile = (await profileRes.json()) as {
      sub: string;
      email?: string;
      name?: string;
      email_verified?: boolean;
    };
    if (!profile.email || !profile.sub) {
      return reply.code(400).send({ error: "Google profile missing email" });
    }
    const email = profile.email.toLowerCase();

    let user = await prisma.user.findFirst({
      where: { OR: [{ googleSub: profile.sub }, { email }] },
    });
    if (!user) {
      const defaultOrg = await prisma.organization.findUnique({
        where: { slug: "default-workspace" },
      });
      user = await prisma.user.create({
        data: {
          name: profile.name ?? email.split("@")[0]!,
          email,
          googleSub: profile.sub,
          role: "USER",
        },
      });
      if (defaultOrg) {
        await prisma.membership.create({
          data: {
            userId: user.id,
            organizationId: defaultOrg.id,
            orgRole: "AGENT",
            status: "ACTIVE",
            permissions: JSON.stringify(defaultPermissionsForOrgRole("AGENT")),
          },
        });
      }
    } else if (!user.googleSub) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { googleSub: profile.sub },
      });
    }

    const token = await tokenForUser(user);
    const web = env.PUBLIC_WEB_URL ?? "http://127.0.0.1:5173";
    return reply.redirect(`${web}/login?google_token=${encodeURIComponent(token)}`);
  });
}
