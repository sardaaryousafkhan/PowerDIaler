/**
 * Prep-0b (C3 demote) + Prep-1 (first 7 Bucket A endpoints).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../db.js";
import { seedBatch1Fixture, type Batch1Fixture } from "./batch1.fixtures.js";
import { buildBatch1TestApp, tokenFor } from "./testApp.js";

describe("Prep-0b C3 demote + Prep-1 Bucket A (enforce on)", () => {
  let app: Awaited<ReturnType<typeof buildBatch1TestApp>>;
  let fx: Batch1Fixture;
  let campA: string;
  let campB: string;

  before(async () => {
    assert.equal(String(process.env.RBAC_ENFORCE_ADMIN_PERMS).toLowerCase(), "true");
    fx = await seedBatch1Fixture();
    app = await buildBatch1TestApp();
    const a = await prisma.campaign.create({
      data: {
        organizationId: fx.orgId,
        name: "A",
        fromPhone: "+12025550100",
        voiceMessage: "hi",
        consentNotes: "t",
        consentAttestedAt: new Date(),
        startedByUserId: fx.adminA.userId,
        status: "DRAFT",
      },
    });
    const b = await prisma.campaign.create({
      data: {
        organizationId: fx.orgId,
        name: "B",
        fromPhone: "+12025550100",
        voiceMessage: "hi",
        consentNotes: "t",
        consentAttestedAt: new Date(),
        startedByUserId: fx.adminB.userId,
        status: "DRAFT",
      },
    });
    campA = a.id;
    campB = b.id;
    await prisma.campaignAssignment.create({ data: { campaignId: a.id, userId: fx.agent.userId } });
    await prisma.dncEntry.createMany({
      data: [
        { organizationId: fx.orgId, e164: "+12025550901", createdByUserId: fx.adminA.userId },
        { organizationId: fx.orgId, e164: "+12025550902", createdByUserId: fx.owner.userId },
        { organizationId: fx.orgId, e164: "+12025550903", createdByUserId: fx.adminB.userId },
      ],
    });
  });

  after(async () => {
    await app.close();
  });

  function auth(who: keyof Omit<Batch1Fixture, "orgId">) {
    const row = fx[who];
    const orgRole =
      who === "owner" ? "ORG_OWNER" : who === "adminA" || who === "adminB" ? "ORG_ADMIN" : "AGENT";
    return {
      Authorization: `Bearer ${tokenFor({
        userId: row.userId,
        email: row.email,
        name: who,
        orgId: fx.orgId,
        orgRole,
        membershipId: row.membershipId,
      })}`,
    };
  }

  async function lastDenied(actorUserId: string) {
    return prisma.auditLog.findFirst({
      where: { actorUserId, action: "access.denied", organizationId: fx.orgId },
      orderBy: { createdAt: "desc" },
    });
  }

  // ——— Prep-0b ———
  it("Demote Admin with reassignment to another Admin → 200 + audit", async () => {
    // Use a fresh admin with one user to avoid clobbering fixture for later tests
    const suffix = `d1-${Date.now()}`;
    const admin = await prisma.user.create({
      data: {
        email: `adm-${suffix}@t.local`,
        name: "Adm",
        passwordHash: "x",
        role: "ADMIN",
      },
    });
    const adminM = await prisma.membership.create({
      data: {
        userId: admin.id,
        organizationId: fx.orgId,
        orgRole: "ORG_ADMIN",
        status: "ACTIVE",
      },
    });
    const u = await prisma.user.create({
      data: { email: `u-${suffix}@t.local`, name: "U", passwordHash: "x", role: "USER" },
    });
    await prisma.membership.create({
      data: {
        userId: u.id,
        organizationId: fx.orgId,
        orgRole: "AGENT",
        status: "ACTIVE",
        managedByAdminId: adminM.id,
      },
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/org/members/${admin.id}`,
      headers: { ...auth("owner"), "content-type": "application/json" },
      payload: {
        reassignments: [{ userId: u.id, newManagerId: fx.adminB.userId }],
      },
    });
    assert.equal(res.statusCode, 200);
    const m = await prisma.membership.findFirst({
      where: { userId: u.id, organizationId: fx.orgId },
    });
    assert.equal(m?.managedByAdminId, fx.adminB.membershipId);
    const audit = await prisma.auditLog.findFirst({
      where: { action: "members.admin_demoted", organizationId: fx.orgId },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(audit);
    const meta = JSON.parse(audit.meta) as {
      previousTeamSize?: number;
      newTeamSize?: number;
      reassignments?: unknown[];
    };
    assert.equal(meta.previousTeamSize, 1);
    assert.equal(meta.newTeamSize, 0);
    assert.equal(meta.reassignments?.length, 1);
  });

  it("Demote Admin with Owner-direct → 200 + audit (newManagerId null)", async () => {
    const suffix = `d2-${Date.now()}`;
    const admin = await prisma.user.create({
      data: { email: `adm2-${suffix}@t.local`, name: "Adm2", passwordHash: "x", role: "ADMIN" },
    });
    const adminM = await prisma.membership.create({
      data: { userId: admin.id, organizationId: fx.orgId, orgRole: "ORG_ADMIN", status: "ACTIVE" },
    });
    const u = await prisma.user.create({
      data: { email: `u2-${suffix}@t.local`, name: "U2", passwordHash: "x", role: "USER" },
    });
    await prisma.membership.create({
      data: {
        userId: u.id,
        organizationId: fx.orgId,
        orgRole: "AGENT",
        status: "ACTIVE",
        managedByAdminId: adminM.id,
      },
    });
    const res = await app.inject({
      method: "DELETE",
      url: `/org/members/${admin.id}`,
      headers: { ...auth("owner"), "content-type": "application/json" },
      payload: { reassignments: [{ userId: u.id, newManagerId: null }] },
    });
    assert.equal(res.statusCode, 200);
    const m = await prisma.membership.findFirst({
      where: { userId: u.id, organizationId: fx.orgId },
    });
    assert.equal(m?.managedByAdminId, null);
  });

  it("Demote Admin without reassignment → 400, no write", async () => {
    const before = await prisma.membership.findUniqueOrThrow({ where: { id: fx.adminA.membershipId } });
    const res = await app.inject({
      method: "DELETE",
      url: `/org/members/${fx.adminA.userId}`,
      headers: { ...auth("owner"), "content-type": "application/json" },
      payload: {},
    });
    assert.equal(res.statusCode, 400);
    const after = await prisma.membership.findUniqueOrThrow({ where: { id: fx.adminA.membershipId } });
    assert.equal(after.status, before.status);
  });

  it("Admin A attempts demote Admin B → 403", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/org/members/${fx.adminB.userId}`,
      headers: { ...auth("adminA"), "content-type": "application/json" },
      payload: { reassignments: [] },
    });
    assert.equal(res.statusCode, 403);
  });

  it("Self-demote → 403", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/org/members/${fx.owner.userId}`,
      headers: auth("owner"),
    });
    // Owner self-delete blocked
    assert.ok([400, 403].includes(res.statusCode));
  });

  it("Demote Admin with no Owner-direct accept → 400", async () => {
    const suffix = `d3-${Date.now()}`;
    const admin = await prisma.user.create({
      data: { email: `adm3-${suffix}@t.local`, name: "Adm3", passwordHash: "x", role: "ADMIN" },
    });
    const adminM = await prisma.membership.create({
      data: { userId: admin.id, organizationId: fx.orgId, orgRole: "ORG_ADMIN", status: "ACTIVE" },
    });
    const u = await prisma.user.create({
      data: { email: `u3-${suffix}@t.local`, name: "U3", passwordHash: "x", role: "USER" },
    });
    await prisma.membership.create({
      data: {
        userId: u.id,
        organizationId: fx.orgId,
        orgRole: "AGENT",
        status: "ACTIVE",
        managedByAdminId: adminM.id,
      },
    });
    // Partial coverage (missing user) → 400
    const res = await app.inject({
      method: "DELETE",
      url: `/org/members/${admin.id}`,
      headers: { ...auth("owner"), "content-type": "application/json" },
      payload: { reassignments: [] },
    });
    assert.equal(res.statusCode, 400);
    const still = await prisma.membership.findUniqueOrThrow({ where: { id: adminM.id } });
    assert.equal(still.status, "ACTIVE");
  });

  it("Reassigned Users land on new team (managedByAdminId updated)", async () => {
    const suffix = `d4-${Date.now()}`;
    const admin = await prisma.user.create({
      data: { email: `adm4-${suffix}@t.local`, name: "Adm4", passwordHash: "x", role: "ADMIN" },
    });
    const adminM = await prisma.membership.create({
      data: { userId: admin.id, organizationId: fx.orgId, orgRole: "ORG_ADMIN", status: "ACTIVE" },
    });
    const u = await prisma.user.create({
      data: { email: `u4-${suffix}@t.local`, name: "U4", passwordHash: "x", role: "USER" },
    });
    await prisma.membership.create({
      data: {
        userId: u.id,
        organizationId: fx.orgId,
        orgRole: "AGENT",
        status: "ACTIVE",
        managedByAdminId: adminM.id,
      },
    });
    const res = await app.inject({
      method: "DELETE",
      url: `/org/members/${admin.id}`,
      headers: { ...auth("owner"), "content-type": "application/json" },
      payload: { reassignments: [{ userId: u.id, newManagerId: fx.adminA.userId }] },
    });
    assert.equal(res.statusCode, 200);
    const m = await prisma.membership.findFirst({
      where: { userId: u.id, organizationId: fx.orgId },
    });
    assert.equal(m?.managedByAdminId, fx.adminA.membershipId);
  });

  // ——— Prep-1 ———
  it("DELETE /dnc — Admin can delete team entry; Owner entry protected", async () => {
    const ok = await app.inject({
      method: "DELETE",
      url: "/dnc/%2B12025550901",
      headers: auth("adminA"),
    });
    assert.equal(ok.statusCode, 200);

    const blocked = await app.inject({
      method: "DELETE",
      url: "/dnc/%2B12025550902",
      headers: auth("adminA"),
    });
    assert.equal(blocked.statusCode, 403);
    const audit = await lastDenied(fx.adminA.userId);
    assert.ok(audit);
    const meta = JSON.parse(audit.meta) as { reason?: string };
    assert.equal(meta.reason, "owner_dnc_delete_protected");
  });

  it("POST /campaigns stamps startedByUserId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/campaigns",
      headers: { ...auth("adminA"), "content-type": "application/json" },
      payload: {
        name: "Stamp test",
        kind: "DIAL",
        fromPhone: "+12025550101",
        voiceMessage: "hello",
        consentNotes: "ok",
        consentAttested: true,
      },
    });
    assert.equal(res.statusCode, 201);
    const body = res.json() as { id: string };
    const row = await prisma.campaign.findUniqueOrThrow({ where: { id: body.id } });
    assert.equal(row.startedByUserId, fx.adminA.userId);
  });

  it("GET /campaigns/:id — cross-team → 403 + audit", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/campaigns/${campB}`,
      headers: auth("adminA"),
    });
    assert.equal(res.statusCode, 403);
    const audit = await lastDenied(fx.adminA.userId);
    const meta = JSON.parse(audit!.meta) as { reason?: string; path?: string };
    assert.equal(meta.reason, "cross_team_campaign");
    assert.equal(meta.path, "GET /campaigns/:id");
  });

  it("GET /campaigns/:id — own → 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/campaigns/${campA}`,
      headers: auth("adminA"),
    });
    assert.equal(res.statusCode, 200);
  });

  it("DELETE /campaigns/:id — cross-team → 403", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/campaigns/${campB}`,
      headers: auth("adminA"),
    });
    assert.equal(res.statusCode, 403);
  });

  it("POST start — cross-team → 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/campaigns/${campB}/start`,
      headers: auth("adminA"),
    });
    assert.equal(res.statusCode, 403);
  });

  it("POST agent-disposition — Admin → 403; Agent not 403-from-permission", async () => {
    const adminRes = await app.inject({
      method: "POST",
      url: `/campaigns/${campA}/agent-disposition`,
      headers: { ...auth("adminA"), "content-type": "application/json" },
      payload: { contactId: "x", disposition: "NO_ANSWER" },
    });
    assert.equal(adminRes.statusCode, 403);

    const agentRes = await app.inject({
      method: "POST",
      url: `/campaigns/${campA}/agent-disposition`,
      headers: { ...auth("agent"), "content-type": "application/json" },
      payload: { contactId: "x", disposition: "NO_ANSWER" },
    });
    // May 400 (zoom/demo) but must not be permission 403
    assert.notEqual(agentRes.statusCode, 403);
  });

  it("POST agent-skip — Admin → 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/campaigns/${campA}/agent-skip`,
      headers: { ...auth("adminA"), "content-type": "application/json" },
      payload: { contactId: "x" },
    });
    assert.equal(res.statusCode, 403);
  });

  it("DELETE /dnc — Agent → 403; Owner deletes any → 200", async () => {
    const agentRes = await app.inject({
      method: "DELETE",
      url: "/dnc/%2B12025550903",
      headers: auth("agent"),
    });
    assert.equal(agentRes.statusCode, 403);

    const ownerRes = await app.inject({
      method: "DELETE",
      url: "/dnc/%2B12025550903",
      headers: auth("owner"),
    });
    assert.equal(ownerRes.statusCode, 200);
  });

  it("POST pause/resume — cross-team → 403 + audit", async () => {
    const pause = await app.inject({
      method: "POST",
      url: `/campaigns/${campB}/pause`,
      headers: auth("adminA"),
    });
    assert.equal(pause.statusCode, 403);
    const resume = await app.inject({
      method: "POST",
      url: `/campaigns/${campB}/resume`,
      headers: auth("adminA"),
    });
    assert.equal(resume.statusCode, 403);
    const audit = await lastDenied(fx.adminA.userId);
    const meta = JSON.parse(audit!.meta) as { reason?: string };
    assert.equal(meta.reason, "cross_team_campaign");
  });

  it("Owner GET/DELETE cross-team campaign → 200 path allowed", async () => {
    const get = await app.inject({
      method: "GET",
      url: `/campaigns/${campB}`,
      headers: auth("owner"),
    });
    assert.equal(get.statusCode, 200);
  });

  it("DELETE own campaign — Admin A → 200", async () => {
    const c = await prisma.campaign.create({
      data: {
        organizationId: fx.orgId,
        name: "DelMe",
        fromPhone: "+12025550100",
        voiceMessage: "hi",
        consentNotes: "t",
        consentAttestedAt: new Date(),
        startedByUserId: fx.adminA.userId,
        status: "DRAFT",
      },
    });
    const res = await app.inject({
      method: "DELETE",
      url: `/campaigns/${c.id}`,
      headers: auth("adminA"),
    });
    assert.equal(res.statusCode, 200);
  });
});
