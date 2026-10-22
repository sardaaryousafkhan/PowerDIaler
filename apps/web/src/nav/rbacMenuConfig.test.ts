/**
 * Role menu snapshots + order + no-DOM-leak invariants (node:test).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { menuForRole, overlappingItemOrder, RBAC_MENU_SECTIONS } from "./rbacMenuConfig.js";

describe("RBAC role menu config", () => {
  it("Owner menu snapshot matches Owner-only surfaces", () => {
    const labels = menuForRole("ORG_OWNER").flatMap((s) => [s.label, ...s.items.map((i) => i.label)]);
    assert.ok(labels.includes("Billing & License"));
    assert.ok(labels.includes("Integrations"));
    assert.ok(labels.includes("Compliance"));
    assert.ok(labels.includes("Company Settings"));
    assert.ok(!labels.includes("Team (my users)"));
  });

  it("Admin menu has team scope and no Owner-only", () => {
    const labels = menuForRole("ORG_ADMIN").flatMap((s) => [s.label, ...s.items.map((i) => i.label)]);
    assert.ok(labels.includes("Team (my users)"));
    assert.ok(labels.includes("My Campaigns"));
    assert.ok(!labels.includes("Billing & License"));
    assert.ok(!labels.includes("Integrations"));
    assert.ok(!labels.includes("Compliance"));
    assert.ok(!labels.includes("Company Settings"));
    assert.ok(!labels.includes("Invitations"));
  });

  it("Agent menu is self-only", () => {
    const labels = menuForRole("AGENT").flatMap((s) => [s.label, ...s.items.map((i) => i.label)]);
    assert.ok(labels.includes("My Profile"));
    assert.ok(labels.includes("My Campaigns") || labels.includes("Assigned campaigns"));
    assert.ok(!labels.includes("Billing & License"));
    assert.ok(!labels.includes("Team Management"));
    assert.ok(!labels.includes("Integrations"));
  });

  it("overlapping item order identical across roles", () => {
    const oa = overlappingItemOrder("ORG_OWNER", "ORG_ADMIN");
    assert.deepEqual(oa.a, oa.b);
    const oe = overlappingItemOrder("ORG_OWNER", "AGENT");
    assert.deepEqual(oe.a, oe.b);
    const ae = overlappingItemOrder("ORG_ADMIN", "AGENT");
    assert.deepEqual(ae.a, ae.b);
  });

  it("hidden Owner items are absent from Admin/Agent lists (no DOM leak source)", () => {
    const ownerOnly = new Set(
      RBAC_MENU_SECTIONS.flatMap((s) =>
        s.items.filter((i) => i.roles.length === 1 && i.roles[0] === "ORG_OWNER").map((i) => i.id),
      ),
    );
    const adminIds = new Set(menuForRole("ORG_ADMIN").flatMap((s) => s.items.map((i) => i.id)));
    const agentIds = new Set(menuForRole("AGENT").flatMap((s) => s.items.map((i) => i.id)));
    for (const id of ownerOnly) {
      assert.equal(adminIds.has(id), false, `Admin must not include ${id}`);
      assert.equal(agentIds.has(id), false, `Agent must not include ${id}`);
    }
  });

  it("single config array drives all roles (not three separate arrays)", () => {
    assert.ok(RBAC_MENU_SECTIONS.length >= 8);
    assert.ok(menuForRole("ORG_OWNER").length > 0);
    assert.ok(menuForRole("ORG_ADMIN").length > 0);
    assert.ok(menuForRole("AGENT").length > 0);
  });
});
