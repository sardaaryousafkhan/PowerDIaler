/**
 * Prep-2 — remaining Bucket A + Bucket B explicit gates.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../db.js";
import { campaignMediaToken, campaignMediaTokenTtl } from "../../lib/webhookToken.js";
import { seedBatch1Fixture, type Batch1Fixture } from "./batch1.fixtures.js";
import { buildBatch1TestApp, tokenFor } from "./testApp.js";

describe("Prep-2 Bucket A remainder + Bucket B (enforce on)", () => {
  let app: Awaited<ReturnType<typeof buildBatch1TestApp>>;
  let fx: Batch1Fixture;
  let campA: string;
  let campB: string;
  let smsCampA: string;
  let contactA: string;

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
    const sms = await prisma.campaign.create({
      data: {
        organizationId: fx.orgId,
        name: "SMS A",
        kind: "SMS",
        fromPhone: "+12025550100",
        voiceMessage: "",
        smsTemplate: "hi",
        consentNotes: "t",
        consentAttestedAt: new Date(),
        startedByUserId: fx.adminA.userId,
        status: "DRAFT",
      },
    });
    campA = a.id;
    campB = b.id;
    smsCampA = sms.id;
    const c = await prisma.contact.create({
      data: { campaignId: a.id, phoneE164: "+12025550111", name: "C1" },
    });
    contactA = c.id;
    await prisma.callAttempt.create({
      data: {
        campaignId: a.id,
        contactId: c.id,
        idempotencyKey: `att-${Date.now()}`,
        disposition: "NO_ANSWER",
      },
    });
    await prisma.auditLog.createMany({
      data: [
        {
          organizationId: fx.orgId,
          actorUserId: fx.adminA.userId,
          action: "test.team_a",
          entityType: "Test",
          meta: "{}",
        },
        {
          organizationId: fx.orgId,
          actorUserId: fx.adminB.userId,
          action: "test.team_b",
          entityType: "Test",
          meta: "{}",
        },
        {
          organizationId: fx.orgId,
          actorUserId: fx.u1.userId,
          action: "test.u1",
          entityType: "Test",
          meta: JSON.stringify({ targetUserId: fx.u2.userId }),
        },
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

  it("PUT assignments — own → 200; cross-team → 403", async () => {
    const ok = await app.inject({
      method: "PUT",
      url: `/campaigns/${campA}/assignments`,
      headers: { ...auth("adminA"), "content-type": "application/json" },
      payload: { userIds: [fx.u1.userId] },
    });
    assert.equal(ok.statusCode, 200);

    const bad = await app.inject({
      method: "PUT",
      url: `/campaigns/${campB}/assignments`,
      headers: { ...auth("adminA"), "content-type": "application/json" },
      payload: { userIds: [fx.u1.userId] },
    });
    assert.equal(bad.statusCode, 403);
  });

  it("POST contacts — cross-team → 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/campaigns/${campB}/contacts`,
      headers: { ...auth("adminA"), "content-type": "application/json" },
      payload: { rows: [{ phone: "+12025550199" }] },
    });
    assert.equal(res.statusCode, 403);
  });

  it("POST contacts — own → 200", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/campaigns/${campA}/contacts`,
      headers: { ...auth("adminA"), "content-type": "application/json" },
      payload: { rows: [{ phone: "+12025550198" }] },
    });
    assert.equal(res.statusCode, 200);
  });

  it("POST sms-template — own SMS → 200; cross → 403", async () => {
    const ok = await app.inject({
      method: "POST",
      url: `/campaigns/${smsCampA}/sms-template`,
      headers: { ...auth("adminA"), "content-type": "application/json" },
      payload: { body: "updated template" },
    });
    assert.equal(ok.statusCode, 200);

    const bad = await app.inject({
      method: "POST",
      url: `/campaigns/${campB}/sms-template`,
      headers: { ...auth("adminA"), "content-type": "application/json" },
      payload: { body: "nope" },
    });
    assert.equal(bad.statusCode, 403);
  });

  it("POST sms — cross-team → 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/campaigns/${campB}/sms`,
      headers: { ...auth("adminA"), "content-type": "application/json" },
      payload: { body: "hello" },
    });
    assert.equal(res.statusCode, 403);
  });

  it("PATCH notes — cross-team → 403; own → 200", async () => {
    const bad = await app.inject({
      method: "PATCH",
      url: `/campaigns/${campB}/contacts/${contactA}/notes`,
      headers: { ...auth("adminA"), "content-type": "application/json" },
      payload: { notes: "x" },
    });
    assert.equal(bad.statusCode, 403);

    const ok = await app.inject({
      method: "PATCH",
      url: `/campaigns/${campA}/contacts/${contactA}/notes`,
      headers: { ...auth("adminA"), "content-type": "application/json" },
      payload: { notes: "team note" },
    });
    assert.equal(ok.statusCode, 200);
  });

  it("GET attempts — Admin sees owned campaign attempts (G4b)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/campaigns/${campA}/attempts`,
      headers: auth("adminA"),
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { calls: unknown[] };
    assert.ok(body.calls.length >= 1);

    const cross = await app.inject({
      method: "GET",
      url: `/campaigns/${campB}/attempts`,
      headers: auth("adminA"),
    });
    assert.equal(cross.statusCode, 403);
  });

  it("GET media-urls — mint TTL; fetch token-only; legacy token still works", async () => {
    const mint = await app.inject({
      method: "GET",
      url: `/campaigns/${campA}/media-urls`,
      headers: auth("adminA"),
    });
    assert.equal(mint.statusCode, 200);
    const urls = mint.json() as { voiceInstructionsUrl: string };
    assert.ok(urls.voiceInstructionsUrl.includes("t="));

    const ttl = campaignMediaTokenTtl(campA);
    const withTtl = await app.inject({
      method: "GET",
      url: `/campaigns/${campA}/voice-instructions?t=${ttl}`,
    });
    assert.equal(withTtl.statusCode, 200);

    const legacy = await app.inject({
      method: "GET",
      url: `/campaigns/${campA}/voice-instructions?t=${campaignMediaToken(campA)}`,
    });
    assert.equal(legacy.statusCode, 200);

    const noToken = await app.inject({
      method: "GET",
      url: `/campaigns/${campA}/voice-instructions`,
      headers: auth("adminA"),
    });
    assert.equal(noToken.statusCode, 403);
  });

  it("GET audit-logs — Admin A team filter; Owner sees all", async () => {
    const adminRes = await app.inject({
      method: "GET",
      url: "/org/audit-logs",
      headers: auth("adminA"),
    });
    assert.equal(adminRes.statusCode, 200);
    const adminLogs = (adminRes.json() as { logs: Array<{ action: string; actorUserId: string | null }> })
      .logs;
    const actions = new Set(adminLogs.map((l) => l.action));
    assert.ok(actions.has("test.team_a") || actions.has("test.u1"));
    assert.ok(!actions.has("test.team_b"), "cross-team audit excluded");

    const ownerRes = await app.inject({
      method: "GET",
      url: "/org/audit-logs",
      headers: auth("owner"),
    });
    assert.equal(ownerRes.statusCode, 200);
    const ownerActions = new Set(
      (ownerRes.json() as { logs: Array<{ action: string }> }).logs.map((l) => l.action),
    );
    assert.ok(ownerActions.has("test.team_b"));
  });

  it("Bucket B — PATCH settings / GET billing / PUT integrations — Admin 403, Owner 200", async () => {
    const settingsAdmin = await app.inject({
      method: "PATCH",
      url: "/org/settings",
      headers: { ...auth("adminA"), "content-type": "application/json" },
      payload: { name: "Nope" },
    });
    assert.equal(settingsAdmin.statusCode, 403);
    const settingsAudit = await lastDenied(fx.adminA.userId);
    assert.ok(settingsAudit);
    assert.equal(
      (JSON.parse(settingsAudit.meta) as { requiredPermission?: string }).requiredPermission,
      "company_settings",
    );

    const settingsOwner = await app.inject({
      method: "PATCH",
      url: "/org/settings",
      headers: { ...auth("owner"), "content-type": "application/json" },
      payload: { name: `Org ${Date.now()}` },
    });
    assert.equal(settingsOwner.statusCode, 200);

    const billingAdmin = await app.inject({
      method: "GET",
      url: "/org/billing",
      headers: auth("adminA"),
    });
    assert.equal(billingAdmin.statusCode, 403);

    const billingOwner = await app.inject({
      method: "GET",
      url: "/org/billing",
      headers: auth("owner"),
    });
    assert.equal(billingOwner.statusCode, 200);

    const prefAdmin = await app.inject({
      method: "PUT",
      url: "/integrations/preference",
      headers: { ...auth("adminA"), "content-type": "application/json" },
      payload: { preferredIntegrationKey: "twilio" },
    });
    assert.equal(prefAdmin.statusCode, 403);

    const prefOwner = await app.inject({
      method: "PUT",
      url: "/integrations/preference",
      headers: { ...auth("owner"), "content-type": "application/json" },
      payload: { preferredIntegrationKey: "twilio" },
    });
    assert.equal(prefOwner.statusCode, 200);

    const setupAdmin = await app.inject({
      method: "PUT",
      url: "/integrations/setup/twilio",
      headers: { ...auth("adminA"), "content-type": "application/json" },
      payload: { values: { accountSid: "ACtest" } },
    });
    assert.equal(setupAdmin.statusCode, 403);
  });

  it("PUT assignments — Owner → 200 on any campaign", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/campaigns/${campB}/assignments`,
      headers: { ...auth("owner"), "content-type": "application/json" },
      payload: { userIds: [fx.u3.userId] },
    });
    assert.equal(res.statusCode, 200);
  });

  it("POST sms — own campaign not permission-403", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/campaigns/${campA}/sms`,
      headers: { ...auth("adminA"), "content-type": "application/json" },
      payload: { body: "hello team" },
    });
    assert.notEqual(res.statusCode, 403);
  });

  it("GET media-urls — cross-team → 403 + audit", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/campaigns/${campB}/media-urls`,
      headers: auth("adminA"),
    });
    assert.equal(res.statusCode, 403);
    const audit = await lastDenied(fx.adminA.userId);
    const meta = JSON.parse(audit!.meta) as { reason?: string; path?: string };
    assert.equal(meta.reason, "cross_team_campaign");
    assert.equal(meta.path, "GET /campaigns/:id/media-urls");
  });

  it("GET voicemail-recording without token → 403", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/campaigns/${campA}/voicemail-recording`,
      headers: auth("owner"),
    });
    assert.equal(res.statusCode, 403);
  });

  it("Agent GET audit-logs → 403", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/org/audit-logs",
      headers: auth("agent"),
    });
    assert.equal(res.statusCode, 403);
  });

  it("Agent PATCH settings → 403", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/org/settings",
      headers: { ...auth("agent"), "content-type": "application/json" },
      payload: { name: "no" },
    });
    assert.equal(res.statusCode, 403);
  });

  it("Agent GET billing → 403", async () => {
    const res = await app.inject({ method: "GET", url: "/org/billing", headers: auth("agent") });
    assert.equal(res.statusCode, 403);
  });

  it("Owner PUT integrations/setup — not Admin-forbidden", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/integrations/setup/twilio",
      headers: { ...auth("owner"), "content-type": "application/json" },
      payload: { values: { accountSid: "ACowner" } },
    });
    // May 400 if provider fields differ; must not be matrix 403
    assert.notEqual(res.statusCode, 403);
  });

  it("POST sms-template audit sample on cross-team denial", async () => {
    await app.inject({
      method: "POST",
      url: `/campaigns/${campB}/sms-template`,
      headers: { ...auth("adminA"), "content-type": "application/json" },
      payload: { body: "x" },
    });
    const audit = await lastDenied(fx.adminA.userId);
    const meta = JSON.parse(audit!.meta) as {
      path?: string;
      requiredPermission?: string;
      reason?: string;
    };
    assert.equal(meta.path, "POST /campaigns/:id/sms-template");
    assert.equal(meta.requiredPermission, "campaign_create");
    assert.equal(meta.reason, "cross_team_campaign");
  });

  it("PATCH notes denial audit — requiredPermission campaign_notes", async () => {
    await app.inject({
      method: "PATCH",
      url: `/campaigns/${campB}/contacts/x/notes`,
      headers: { ...auth("adminA"), "content-type": "application/json" },
      payload: { notes: "n" },
    });
    const audit = await lastDenied(fx.adminA.userId);
    const meta = JSON.parse(audit!.meta) as { requiredPermission?: string };
    assert.equal(meta.requiredPermission, "campaign_notes");
  });

  it("GET attempts denial audit — cross_team_campaign", async () => {
    await app.inject({
      method: "GET",
      url: `/campaigns/${campB}/attempts`,
      headers: auth("adminA"),
    });
    const audit = await lastDenied(fx.adminA.userId);
    const meta = JSON.parse(audit!.meta) as { reason?: string; path?: string };
    assert.equal(meta.reason, "cross_team_campaign");
    assert.equal(meta.path, "GET /campaigns/:id/attempts");
  });

  it("Bucket B billing denial audit sample", async () => {
    await app.inject({ method: "GET", url: "/org/billing", headers: auth("adminA") });
    const audit = await lastDenied(fx.adminA.userId);
    const meta = JSON.parse(audit!.meta) as {
      path?: string;
      requiredPermission?: string;
      orgRole?: string;
    };
    assert.equal(meta.path, "GET /org/billing");
    assert.equal(meta.requiredPermission, "billing_view");
    assert.equal(meta.orgRole, "ORG_ADMIN");
  });

  it("Bucket B integrations preference denial audit sample", async () => {
    await app.inject({
      method: "PUT",
      url: "/integrations/preference",
      headers: { ...auth("adminA"), "content-type": "application/json" },
      payload: { preferredIntegrationKey: "twilio" },
    });
    const audit = await lastDenied(fx.adminA.userId);
    const meta = JSON.parse(audit!.meta) as { requiredPermission?: string; path?: string };
    assert.equal(meta.requiredPermission, "integrations_manage");
    assert.equal(meta.path, "PUT /integrations/preference");
  });

  it("PUT assignments cross-team audit sample", async () => {
    await app.inject({
      method: "PUT",
      url: `/campaigns/${campB}/assignments`,
      headers: { ...auth("adminA"), "content-type": "application/json" },
      payload: { userIds: [] },
    });
    const audit = await lastDenied(fx.adminA.userId);
    const meta = JSON.parse(audit!.meta) as { path?: string; reason?: string };
    assert.equal(meta.path, "PUT /campaigns/:id/assignments");
    assert.equal(meta.reason, "cross_team_campaign");
  });

  it("POST contacts cross-team audit sample", async () => {
    await app.inject({
      method: "POST",
      url: `/campaigns/${campB}/contacts`,
      headers: { ...auth("adminA"), "content-type": "application/json" },
      payload: { rows: [] },
    });
    const audit = await lastDenied(fx.adminA.userId);
    const meta = JSON.parse(audit!.meta) as { path?: string; requiredPermission?: string };
    assert.equal(meta.path, "POST /campaigns/:id/contacts");
    assert.equal(meta.requiredPermission, "contact_import");
  });

  it("POST sms cross-team audit sample", async () => {
    await app.inject({
      method: "POST",
      url: `/campaigns/${campB}/sms`,
      headers: { ...auth("adminA"), "content-type": "application/json" },
      payload: { body: "x" },
    });
    const audit = await lastDenied(fx.adminA.userId);
    const meta = JSON.parse(audit!.meta) as { requiredPermission?: string; reason?: string };
    assert.equal(meta.requiredPermission, "sms_broadcast");
    assert.equal(meta.reason, "cross_team_campaign");
  });

  it("Bucket B verified statement — Admin 403 on all four Owner-only surfaces", async () => {
    const paths: Array<{ method: "GET" | "PATCH" | "PUT"; url: string; payload?: object }> = [
      { method: "PATCH", url: "/org/settings", payload: { name: "x" } },
      { method: "GET", url: "/org/billing" },
      { method: "PUT", url: "/integrations/preference", payload: { preferredIntegrationKey: "twilio" } },
      { method: "PUT", url: "/integrations/setup/twilio", payload: { values: { accountSid: "x" } } },
    ];
    for (const p of paths) {
      const res = await app.inject({
        method: p.method,
        url: p.url,
        headers: p.payload
          ? { ...auth("adminA"), "content-type": "application/json" }
          : auth("adminA"),
        payload: p.payload,
      });
      assert.equal(res.statusCode, 403, p.url);
    }
  });
});
