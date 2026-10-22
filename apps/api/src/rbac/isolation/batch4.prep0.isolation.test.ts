/**
 * Batch 4-prep-0 — members_change_role (privilege escalation vector).
 * Requires RBAC_ENFORCE_ADMIN_PERMS=true.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../db.js";
import { seedBatch1Fixture, type Batch1Fixture } from "./batch1.fixtures.js";
import { buildBatch1TestApp, tokenFor } from "./testApp.js";

describe("Batch 4-prep-0 members_change_role (enforce on)", () => {
  let app: Awaited<ReturnType<typeof buildBatch1TestApp>>;
  let fx: Batch1Fixture;

  before(async () => {
    assert.equal(
      String(process.env.RBAC_ENFORCE_ADMIN_PERMS).toLowerCase(),
      "true",
      "CI/tests must set RBAC_ENFORCE_ADMIN_PERMS=true",
    );
    fx = await seedBatch1Fixture();
    app = await buildBatch1TestApp();
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

  it("self-promote Admin → Owner → 403 + audit", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/admin/access/users/${fx.adminA.userId}`,
      headers: { ...auth("adminA"), "content-type": "application/json" },
      payload: { orgRole: "ORG_OWNER", permissions: {} },
    });
    assert.equal(res.statusCode, 403);
    const audit = await lastDenied(fx.adminA.userId);
    assert.ok(audit);
    const meta = JSON.parse(audit.meta) as { path?: string; requiredPermission?: string; reason?: string };
    assert.equal(meta.path, "PATCH /admin/access/users/:id");
    assert.equal(meta.requiredPermission, "members_change_role");
    assert.equal(meta.reason, "role_escalation");
    const row = await prisma.membership.findUniqueOrThrow({ where: { id: fx.adminA.membershipId } });
    assert.equal(row.orgRole, "ORG_ADMIN", "role must not change");
  });

  it("Admin → promote Agent to Owner → 403 + audit", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/admin/access/users/${fx.u1.userId}`,
      headers: { ...auth("adminA"), "content-type": "application/json" },
      payload: { orgRole: "ORG_OWNER", permissions: {} },
    });
    assert.equal(res.statusCode, 403);
    const audit = await lastDenied(fx.adminA.userId);
    assert.ok(audit);
    const meta = JSON.parse(audit.meta) as { requiredPermission?: string; reason?: string };
    assert.equal(meta.requiredPermission, "members_change_role");
    assert.equal(meta.reason, "role_escalation");
  });

  it("Admin → demote Admin B (another team) → 403 + audit", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/admin/access/users/${fx.adminB.userId}`,
      headers: { ...auth("adminA"), "content-type": "application/json" },
      payload: { orgRole: "AGENT", permissions: {} },
    });
    assert.equal(res.statusCode, 403);
    const audit = await lastDenied(fx.adminA.userId);
    assert.ok(audit);
    const meta = JSON.parse(audit.meta) as { requiredPermission?: string; path?: string; reason?: string };
    assert.equal(meta.requiredPermission, "members_change_role");
    assert.equal(meta.path, "PATCH /admin/access/users/:id");
    assert.equal(meta.reason, "role_escalation");
  });

  it("Agent → PATCH role → 403", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/admin/access/users/${fx.u1.userId}`,
      headers: { ...auth("agent"), "content-type": "application/json" },
      payload: { orgRole: "ORG_ADMIN", permissions: {} },
    });
    assert.equal(res.statusCode, 403);
  });

  it("Owner → Admin (demote Admin A to AGENT) → 200", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/admin/access/users/${fx.adminA.userId}`,
      headers: { ...auth("owner"), "content-type": "application/json" },
      payload: { orgRole: "AGENT", permissions: {} },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { orgRole: string };
    assert.equal(body.orgRole, "AGENT");
    // restore for later tests in this suite
    await prisma.membership.update({
      where: { id: fx.adminA.membershipId },
      data: { orgRole: "ORG_ADMIN" },
    });
  });

  it("Owner → promote Agent to Admin → 200", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/admin/access/users/${fx.u2.userId}`,
      headers: { ...auth("owner"), "content-type": "application/json" },
      payload: { orgRole: "ORG_ADMIN", permissions: {} },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { orgRole: string };
    assert.equal(body.orgRole, "ORG_ADMIN");
    await prisma.membership.update({
      where: { id: fx.u2.membershipId },
      data: { orgRole: "AGENT", managedByAdminId: fx.adminA.membershipId },
    });
  });

});
