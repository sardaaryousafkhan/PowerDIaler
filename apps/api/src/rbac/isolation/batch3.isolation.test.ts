/**
 * Batch 3 isolation — E07 / E08 + members_invite re-keys.
 * Requires RBAC_ENFORCE_ADMIN_PERMS=true (set in package.json test:rbac).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../db.js";
import { seedBatch1Fixture, type Batch1Fixture } from "./batch1.fixtures.js";
import { buildBatch1TestApp, tokenFor } from "./testApp.js";

describe("Batch 3 isolation (enforce on)", () => {
  let app: Awaited<ReturnType<typeof buildBatch1TestApp>>;
  let fx: Batch1Fixture;
  let campA: string;
  let campB: string;
  let campOwnerAssignedToA: string;

  before(async () => {
    assert.equal(
      String(process.env.RBAC_ENFORCE_ADMIN_PERMS).toLowerCase(),
      "true",
      "CI/tests must set RBAC_ENFORCE_ADMIN_PERMS=true",
    );
    fx = await seedBatch1Fixture();
    app = await buildBatch1TestApp();

    const a = await prisma.campaign.create({
      data: {
        organizationId: fx.orgId,
        name: "A owned",
        fromPhone: "+12025550100",
        voiceMessage: "hi",
        consentNotes: "t",
        startedByUserId: fx.adminA.userId,
      },
    });
    const b = await prisma.campaign.create({
      data: {
        organizationId: fx.orgId,
        name: "B owned",
        fromPhone: "+12025550100",
        voiceMessage: "hi",
        consentNotes: "t",
        startedByUserId: fx.adminB.userId,
      },
    });
    const o = await prisma.campaign.create({
      data: {
        organizationId: fx.orgId,
        name: "Owner started assigned to A team",
        fromPhone: "+12025550100",
        voiceMessage: "hi",
        consentNotes: "t",
        startedByUserId: fx.owner.userId,
      },
    });
    campA = a.id;
    campB = b.id;
    campOwnerAssignedToA = o.id;

    await prisma.campaignAssignment.createMany({
      data: [
        { campaignId: a.id, userId: fx.u1.userId },
        { campaignId: b.id, userId: fx.u3.userId },
        { campaignId: o.id, userId: fx.u1.userId },
        { campaignId: a.id, userId: fx.agent.userId },
      ],
    });

    await prisma.dncEntry.createMany({
      data: [
        { organizationId: fx.orgId, e164: "+12025550121", createdByUserId: fx.adminA.userId },
        { organizationId: fx.orgId, e164: "+12025550122", createdByUserId: fx.adminB.userId },
        { organizationId: fx.orgId, e164: "+12025550123", createdByUserId: fx.owner.userId },
        { organizationId: fx.orgId, e164: "+12025550124", createdByUserId: null },
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

  it("E07 — Admin A GET /dnc → team + Owner-shared only", async () => {
    const res = await app.inject({ method: "GET", url: "/dnc", headers: auth("adminA") });
    assert.equal(res.statusCode, 200);
    const rows = res.json() as Array<{ e164: string; createdByUserId: string | null }>;
    const e164s = new Set(rows.map((r) => r.e164));
    assert.ok(e164s.has("+12025550121"), "own team entry");
    assert.ok(e164s.has("+12025550123"), "Owner-shared");
    assert.ok(e164s.has("+12025550124"), "legacy null = Owner-shared");
    assert.ok(!e164s.has("+12025550122"), "must not see Admin B entry");
  });

  it("E07 — Agent GET /dnc → 403 + audit", async () => {
    const res = await app.inject({ method: "GET", url: "/dnc", headers: auth("agent") });
    assert.equal(res.statusCode, 403);
    const audit = await lastDenied(fx.agent.userId);
    assert.ok(audit);
    const meta = JSON.parse(audit.meta) as { path?: string; requiredPermission?: string; reason?: string };
    assert.equal(meta.path, "GET /dnc");
    assert.equal(meta.requiredPermission, "dnc_manage");
    assert.equal(meta.reason, "forbidden");
  });

  it("E08 — Admin A GET /campaigns → startedBy-owned only (E02-coherent)", async () => {
    const res = await app.inject({ method: "GET", url: "/campaigns", headers: auth("adminA") });
    assert.equal(res.statusCode, 200);
    const rows = res.json() as Array<{ id: string }>;
    const ids = new Set(rows.map((r) => r.id));
    assert.ok(ids.has(campA));
    assert.ok(!ids.has(campB), "not Admin B campaign");
    // Owner-started but assigned to A's team is still out of scope (same as E02 startedBy-only).
    assert.ok(!ids.has(campOwnerAssignedToA), "Owner-started assigned-to-team deferred with E02");
  });

  it("E08 — Agent GET /campaigns → assigned only", async () => {
    const res = await app.inject({ method: "GET", url: "/campaigns", headers: auth("agent") });
    assert.equal(res.statusCode, 200);
    const rows = res.json() as Array<{ id: string }>;
    const ids = new Set(rows.map((r) => r.id));
    assert.ok(ids.has(campA));
    assert.ok(!ids.has(campB));
  });

  it("E08 — Owner GET /campaigns → all", async () => {
    const res = await app.inject({ method: "GET", url: "/campaigns", headers: auth("owner") });
    assert.equal(res.statusCode, 200);
    const rows = res.json() as Array<{ id: string }>;
    const ids = new Set(rows.map((r) => r.id));
    assert.ok(ids.has(campA) && ids.has(campB) && ids.has(campOwnerAssignedToA));
  });

  it("Invite re-key — Admin POST /org/invites → 403 + audit members_invite", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/org/invites",
      headers: { ...auth("adminA"), "content-type": "application/json" },
      payload: { email: "newhire@test.local", orgRole: "AGENT" },
    });
    assert.equal(res.statusCode, 403);
    const audit = await lastDenied(fx.adminA.userId);
    assert.ok(audit);
    const meta = JSON.parse(audit.meta) as { path?: string; requiredPermission?: string; reason?: string };
    assert.equal(meta.path, "POST /org/invites");
    assert.equal(meta.requiredPermission, "members_invite");
    assert.equal(meta.reason, "forbidden");
  });

  it("Invite re-key — Admin GET /org/invites → 403; Owner → 200", async () => {
    const adminRes = await app.inject({ method: "GET", url: "/org/invites", headers: auth("adminA") });
    assert.equal(adminRes.statusCode, 403);

    const ownerRes = await app.inject({ method: "GET", url: "/org/invites", headers: auth("owner") });
    assert.equal(ownerRes.statusCode, 200);
  });

  it("Invite re-key — Admin POST /org/members → 403; Owner → 201", async () => {
    const adminRes = await app.inject({
      method: "POST",
      url: "/org/members",
      headers: { ...auth("adminA"), "content-type": "application/json" },
      payload: { name: "Blocked", email: `blocked-${Date.now()}@test.local`, orgRole: "AGENT" },
    });
    assert.equal(adminRes.statusCode, 403);

    const ownerRes = await app.inject({
      method: "POST",
      url: "/org/members",
      headers: { ...auth("owner"), "content-type": "application/json" },
      payload: { name: "Ok Member", email: `ok-${Date.now()}@test.local`, orgRole: "AGENT" },
    });
    assert.equal(ownerRes.statusCode, 201);
  });
});
