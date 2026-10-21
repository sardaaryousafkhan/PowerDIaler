/**
 * Batch 1 isolation — requires RBAC_ENFORCE_ADMIN_PERMS=true (set in package.json test:rbac).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../db.js";
import { seedBatch1Fixture, type Batch1Fixture } from "./batch1.fixtures.js";
import { buildBatch1TestApp, tokenFor } from "./testApp.js";
import {
  ORG_SETTINGS_ADMIN_KEYS,
  ORG_SETTINGS_AGENT_KEYS,
  ORG_SETTINGS_OWNER_ONLY_KEYS,
} from "./isolation.skeleton.test.js";

describe("Batch 1 isolation (enforce on)", () => {
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

  it("Test A — GET /org/settings role-shaped bodies", async () => {
    const ownerRes = await app.inject({ method: "GET", url: "/org/settings", headers: auth("owner") });
    assert.equal(ownerRes.statusCode, 200);
    const ownerBody = ownerRes.json() as Record<string, unknown>;
    for (const k of ["id", "name", "slug", "settings", "smsPerMinute", "preferredIntegrationKey", "plan", "subscription"]) {
      assert.ok(k in ownerBody, `Owner missing ${k}`);
    }
    assert.equal((ownerBody.settings as { timezone?: string }).timezone, "America/New_York");

    const adminRes = await app.inject({ method: "GET", url: "/org/settings", headers: auth("adminA") });
    assert.equal(adminRes.statusCode, 200);
    const adminBody = adminRes.json() as Record<string, unknown>;
    // Exact Admin shape
    assert.deepEqual(Object.keys(adminBody).sort(), [...ORG_SETTINGS_ADMIN_KEYS].sort());
    for (const k of ORG_SETTINGS_OWNER_ONLY_KEYS) {
      assert.ok(!(k in adminBody), `Admin must not see ${k}`);
    }
    assert.deepEqual(adminBody.settings, { timezone: "America/New_York" });
    assert.equal(adminBody.smsPerMinute, 30);
    assert.equal(adminBody.preferredIntegrationKey, "twilio");

    const agentRes = await app.inject({ method: "GET", url: "/org/settings", headers: auth("agent") });
    assert.equal(agentRes.statusCode, 200);
    const agentBody = agentRes.json() as Record<string, unknown>;
    assert.deepEqual(Object.keys(agentBody).sort(), [...ORG_SETTINGS_AGENT_KEYS].sort());
    assert.equal(agentBody.smsPerMinute, 30);
    assert.equal(agentBody.preferredIntegrationKey, "twilio");
  });

  it("R1 — Admin GET /integrations → 403 + audit", async () => {
    const res = await app.inject({ method: "GET", url: "/integrations", headers: auth("adminA") });
    assert.equal(res.statusCode, 403);
    const audit = await lastDenied(fx.adminA.userId);
    assert.ok(audit, "access.denied audit required");
    const meta = JSON.parse(audit.meta) as { path?: string; requiredPermission?: string };
    assert.equal(meta.path, "GET /integrations");
    assert.equal(meta.requiredPermission, "integrations_manage");
  });

  it("E09 — Admin GET crm provider status → 403 + audit", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/crm/providers/hubspot/status",
      headers: auth("adminA"),
    });
    assert.equal(res.statusCode, 403);
    const audit = await lastDenied(fx.adminA.userId);
    assert.ok(audit);
    const meta = JSON.parse(audit.meta) as { path?: string };
    assert.equal(meta.path, "GET /crm/providers/:provider/status");
  });

  it("E10 — Agent GET /crm/activities → 403; Admin team OK", async () => {
    const agentRes = await app.inject({ method: "GET", url: "/crm/activities", headers: auth("agent") });
    assert.equal(agentRes.statusCode, 403, "Agent has crm_view self only — team list denied");

    const adminRes = await app.inject({ method: "GET", url: "/crm/activities", headers: auth("adminA") });
    assert.equal(adminRes.statusCode, 200);
  });

  it("E12 — Agent POST /crm/activities/log self → 200", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/crm/activities/log",
      headers: { ...auth("agent"), "content-type": "application/json" },
      payload: {
        provider: "hubspot",
        type: "note",
        summary: "agent self log",
      },
    });
    assert.equal(res.statusCode, 200);
  });

  it("Test B — Admin A upsert for Admin B user u3 → 403 + audit", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/crm/contacts/upsert",
      headers: { ...auth("adminA"), "content-type": "application/json" },
      payload: {
        provider: "hubspot",
        email: "cross@team.test",
        phoneE164: "+12025550199",
        assignedUserId: fx.u3.userId,
      },
    });
    assert.equal(res.statusCode, 403);
    const audit = await lastDenied(fx.adminA.userId);
    assert.ok(audit);
    const meta = JSON.parse(audit.meta) as { reason?: string; path?: string };
    assert.equal(meta.path, "POST /crm/contacts/upsert");
    assert.equal(meta.reason, "cross_team_assignedUserId");
  });

  it("E11 — Admin A upsert for own u1 → 200", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/crm/contacts/upsert",
      headers: { ...auth("adminA"), "content-type": "application/json" },
      payload: {
        provider: "hubspot",
        email: "team@ok.test",
        phoneE164: "+12025550101",
        assignedUserId: fx.u1.userId,
      },
    });
    assert.equal(res.statusCode, 200);
  });

  it("E11 — Admin A upsert without assignedUserId → 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/crm/contacts/upsert",
      headers: { ...auth("adminA"), "content-type": "application/json" },
      payload: {
        provider: "hubspot",
        email: "missing-owner@test.local",
        phoneE164: "+12025550102",
      },
    });
    assert.equal(res.statusCode, 403);
  });
});
