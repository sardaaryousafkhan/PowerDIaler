/**
 * Batch 2 isolation — E01 / E02 / E05 / E06.
 * Requires RBAC_ENFORCE_ADMIN_PERMS=true (set in package.json test:rbac).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../db.js";
import { seedBatch1Fixture, type Batch1Fixture } from "./batch1.fixtures.js";
import { buildBatch1TestApp, tokenFor } from "./testApp.js";

describe("Batch 2 isolation (enforce on)", () => {
  let app: Awaited<ReturnType<typeof buildBatch1TestApp>>;
  let fx: Batch1Fixture;
  let campaignOwnedByA: string;
  let campaignOwnedByB: string;

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
        name: "Admin A campaign",
        fromPhone: "+12025550100",
        voiceMessage: "hi",
        consentNotes: "test",
        startedByUserId: fx.adminA.userId,
      },
    });
    const b = await prisma.campaign.create({
      data: {
        organizationId: fx.orgId,
        name: "Admin B campaign",
        fromPhone: "+12025550100",
        voiceMessage: "hi",
        consentNotes: "test",
        startedByUserId: fx.adminB.userId,
      },
    });
    campaignOwnedByA = a.id;
    campaignOwnedByB = b.id;

    await prisma.campaignAssignment.createMany({
      data: [
        { campaignId: a.id, userId: fx.u1.userId },
        { campaignId: b.id, userId: fx.u3.userId },
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

  it("E01 — Admin A GET /admin/access/users → 200 team only (self row + managed)", async () => {
    const res = await app.inject({ method: "GET", url: "/admin/access/users", headers: auth("adminA") });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { users: Array<{ id: string; membershipId: string }> };
    const ids = new Set(body.users.map((u) => u.id));
    // "self" = Admin's own membership row is returned in the list (response content), not merely authorized.
    assert.ok(
      body.users.some((u) => u.membershipId === fx.adminA.membershipId),
      "response must include Admin A's own membership row",
    );
    assert.ok(ids.has(fx.adminA.userId));
    assert.ok(ids.has(fx.u1.userId));
    assert.ok(ids.has(fx.u2.userId));
    assert.ok(ids.has(fx.agent.userId));
    assert.ok(!ids.has(fx.u3.userId), "must not see Admin B's agent");
    assert.ok(!ids.has(fx.adminB.userId), "must not see peer Admin");
    assert.ok(!ids.has(fx.owner.userId), "must not see Owner");

    const returnedMembershipIds = body.users.map((u) => u.membershipId);
    const rows = await prisma.membership.findMany({
      where: { id: { in: returnedMembershipIds }, organizationId: fx.orgId },
      select: { id: true, managedByAdminId: true },
    });
    for (const row of rows) {
      const ok =
        row.id === fx.adminA.membershipId || row.managedByAdminId === fx.adminA.membershipId;
      assert.ok(ok, `row ${row.id} must be self or managedByAdminId=A (got managedBy=${row.managedByAdminId})`);
      assert.notEqual(row.managedByAdminId, fx.adminB.membershipId, "no Admin B team rows");
    }
  });

  it("E01 — Owner sees all; Agent → 403 + audit", async () => {
    const ownerRes = await app.inject({ method: "GET", url: "/admin/access/users", headers: auth("owner") });
    assert.equal(ownerRes.statusCode, 200);
    const ownerBody = ownerRes.json() as { users: Array<{ id: string }> };
    assert.ok(ownerBody.users.length >= 7);

    const agentRes = await app.inject({ method: "GET", url: "/admin/access/users", headers: auth("agent") });
    assert.equal(agentRes.statusCode, 403);
    const audit = await lastDenied(fx.agent.userId);
    assert.ok(audit);
    const meta = JSON.parse(audit.meta) as { path?: string; requiredPermission?: string };
    assert.equal(meta.path, "GET /admin/access/users");
    assert.equal(meta.requiredPermission, "members_manage");
  });

  it("E02 — Admin A GET own campaign assignments → 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignOwnedByA}/assignments`,
      headers: auth("adminA"),
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { assignments: Array<{ userId: string }> };
    assert.equal(body.assignments.length, 1);
    assert.equal(body.assignments[0]?.userId, fx.u1.userId);
  });

  it("E02 — Admin A GET Admin B campaign → 403 + audit cross_team_campaign", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignOwnedByB}/assignments`,
      headers: auth("adminA"),
    });
    assert.equal(res.statusCode, 403);
    const audit = await lastDenied(fx.adminA.userId);
    assert.ok(audit);
    const meta = JSON.parse(audit.meta) as { path?: string; reason?: string };
    assert.equal(meta.path, "GET /campaigns/:id/assignments");
    assert.equal(meta.reason, "cross_team_campaign");
  });

  it("E02 — Owner GET either campaign → 200; Agent → 403", async () => {
    const o1 = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignOwnedByA}/assignments`,
      headers: auth("owner"),
    });
    const o2 = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignOwnedByB}/assignments`,
      headers: auth("owner"),
    });
    assert.equal(o1.statusCode, 200);
    assert.equal(o2.statusCode, 200);

    const agentRes = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignOwnedByA}/assignments`,
      headers: auth("agent"),
    });
    assert.equal(agentRes.statusCode, 403);
  });

  it("E05 — Admin GET /integrations/setup/:provider → 403 + audit", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/integrations/setup/twilio",
      headers: auth("adminA"),
    });
    assert.equal(res.statusCode, 403);
    const audit = await lastDenied(fx.adminA.userId);
    assert.ok(audit);
    const meta = JSON.parse(audit.meta) as { path?: string; requiredPermission?: string };
    assert.equal(meta.path, "GET /integrations/setup/:provider");
    assert.equal(meta.requiredPermission, "integrations_manage");
  });

  it("E05 — Owner GET setup → 200; Agent → 403", async () => {
    const ownerRes = await app.inject({
      method: "GET",
      url: "/integrations/setup/twilio",
      headers: auth("owner"),
    });
    assert.equal(ownerRes.statusCode, 200);

    const agentRes = await app.inject({
      method: "GET",
      url: "/integrations/setup/twilio",
      headers: auth("agent"),
    });
    assert.equal(agentRes.statusCode, 403);
  });

  it("E06 — Admin GET google_voice bridge-health → 403 + audit", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/integrations/google_voice/bridge-health",
      headers: auth("adminA"),
    });
    assert.equal(res.statusCode, 403);
    const audit = await lastDenied(fx.adminA.userId);
    assert.ok(audit);
    const meta = JSON.parse(audit.meta) as { path?: string; requiredPermission?: string };
    assert.equal(meta.path, "GET /integrations/google_voice/bridge-health");
    assert.equal(meta.requiredPermission, "integrations_manage");
  });

  it("E06 — Admin GET zoom_phone bridge-health → 403 + audit", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/integrations/zoom_phone/bridge-health",
      headers: auth("adminA"),
    });
    assert.equal(res.statusCode, 403);
    const audit = await lastDenied(fx.adminA.userId);
    assert.ok(audit);
    const meta = JSON.parse(audit.meta) as { path?: string; requiredPermission?: string };
    assert.equal(meta.path, "GET /integrations/zoom_phone/bridge-health");
    assert.equal(meta.requiredPermission, "integrations_manage");
  });

  it("E06 — Owner bridge-health allowed past permission gate (may 503 if bridge down)", async () => {
    const gv = await app.inject({
      method: "GET",
      url: "/integrations/google_voice/bridge-health",
      headers: auth("owner"),
    });
    // Permission passed; bridge may be down in CI → 503 is OK, 403 is not.
    assert.notEqual(gv.statusCode, 403);

    const zp = await app.inject({
      method: "GET",
      url: "/integrations/zoom_phone/bridge-health",
      headers: auth("owner"),
    });
    assert.notEqual(zp.statusCode, 403);
  });
});
