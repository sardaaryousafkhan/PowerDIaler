/**
 * Menu render + order + DOM-absence source + a11y invariants (node:test).
 * queryByText-style absence: labels not returned by menuForRole will never mount.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clientMatrixAllows } from "./clientPermissionMatrix.js";
import {
  friendlyAccessDeniedMessage,
  isOwnerOnlyPath,
  menuForRole,
  overlappingItemOrder,
  RBAC_MENU_SECTIONS,
  sectionOrderKeys,
  type MenuRole,
} from "./rbacMenuConfig.js";

/** Simulates queryByText(label) === null for a role's rendered menu. */
function queryByText(role: MenuRole, text: string): string | null {
  const hay = menuForRole(role).flatMap((s) => [s.label, ...s.items.map((i) => i.label)]);
  return hay.includes(text) ? text : null;
}

const OWNER_ONLY_LABELS = [
  "Company Settings",
  "Billing & License",
  "Subscription",
  "Invitations",
  "Roles & Permissions",
  "Integrations",
  "Compliance",
  "Global Dialer",
  "System Status",
  "All Campaigns",
  "DNC Management",
];

const ADMIN_ONLY_LABELS = ["Team (my users)", "My Users", "Campaigns (my scope)", "DNC (view / add)"];

describe("RBAC role menu — §1 snapshots", () => {
  it("Owner sees full Owner menu (snapshot labels)", () => {
    const sections = menuForRole("ORG_OWNER").map((s) => s.label);
    assert.deepEqual(sections, [
      "Profile / Account",
      "Billing & License",
      "Team Management",
      "Campaigns",
      "Leads / Contacts",
      "Reports",
      "Integrations",
      "Compliance",
      "Settings",
      "Support",
    ]);
    for (const label of [
      "Company Settings",
      "My Profile",
      "Change Password",
      "Subscription",
      "Invoices",
      "Seat Usage",
      "Users",
      "Admins",
      "Roles & Permissions",
      "Invitations",
      "Assign Users → Admin",
      "All Campaigns",
      "Create / Edit / Archive",
      "Assign Campaigns",
      "All Contacts",
      "Import / Export",
      "List Assignment",
      "DNC Management",
      "Global Dashboard",
      "Per-Admin",
      "Per-User",
      "Call Recordings",
      "Export",
      "CRM",
      "Webhooks",
      "API Keys",
      "Telephony Provider",
      "Recording Policy",
      "Consent",
      "Retention",
      "Audit Log",
      "Global Dialer",
      "Caller IDs",
      "Business Hours",
      "Number Pool",
      "Help Center",
      "Contact Support",
      "System Status",
    ]) {
      assert.equal(queryByText("ORG_OWNER", label), label, `Owner missing ${label}`);
    }
  });

  it("Admin sees exactly Admin list; Owner items not in DOM source", () => {
    const sections = menuForRole("ORG_ADMIN").map((s) => s.label);
    assert.deepEqual(sections, [
      "Profile / Account",
      "Team (my users)",
      "Campaigns (my scope)",
      "Leads / Contacts (my scope)",
      "Reports (my scope)",
      "Support",
    ]);
    for (const label of ADMIN_ONLY_LABELS) {
      assert.equal(queryByText("ORG_ADMIN", label), label);
    }
    for (const label of OWNER_ONLY_LABELS) {
      assert.equal(queryByText("ORG_ADMIN", label), null, `Admin must not see ${label}`);
    }
    assert.equal(queryByText("ORG_ADMIN", "Invitations"), null);
    assert.equal(queryByText("ORG_ADMIN", "Roles & Permissions"), null);
  });

  it("Agent sees exactly Agent list; Admin/Owner items absent", () => {
    const sections = menuForRole("AGENT").map((s) => s.label);
    assert.deepEqual(sections, [
      "Profile / Account",
      "My Campaigns",
      "My Leads",
      "My Stats",
      "My Settings",
      "Support",
    ]);
    assert.equal(queryByText("AGENT", "My Profile"), "My Profile");
    assert.equal(queryByText("AGENT", "Assigned campaigns"), "Assigned campaigns");
    assert.equal(queryByText("AGENT", "Help Center"), "Help Center");
    // recordings_view_self denied by matrix → not in DOM
    assert.equal(queryByText("AGENT", "My recordings"), null);
    for (const label of [...OWNER_ONLY_LABELS, ...ADMIN_ONLY_LABELS, "Billing & License", "Team Management"]) {
      assert.equal(queryByText("AGENT", label), null, `Agent must not see ${label}`);
    }
  });

  it("overlapping items same order across roles", () => {
    const oa = overlappingItemOrder("ORG_OWNER", "ORG_ADMIN");
    assert.deepEqual(oa.a, oa.b);
    const oe = overlappingItemOrder("ORG_OWNER", "AGENT");
    assert.deepEqual(oe.a, oe.b);
    const ae = overlappingItemOrder("ORG_ADMIN", "AGENT");
    assert.deepEqual(ae.a, ae.b);
    // Shared personal items order: My Profile before Change Password before Help Center
    const shared = overlappingItemOrder("ORG_OWNER", "ORG_ADMIN").a;
    const iProfile = shared.indexOf("My Profile");
    const iPw = shared.indexOf("Change Password");
    const iHelp = shared.indexOf("Help Center");
    assert.ok(iProfile >= 0 && iPw > iProfile);
    assert.ok(iHelp > iPw);
  });

  it("section family order Profile → Team → Campaigns → Leads → Reports → Support", () => {
    for (const role of ["ORG_OWNER", "ORG_ADMIN", "AGENT"] as MenuRole[]) {
      const keys = sectionOrderKeys(role);
      const idx = (k: string) => keys.indexOf(k);
      assert.ok(idx("profile") >= 0, `${role} missing profile`);
      if (idx("team") >= 0) assert.ok(idx("team") < idx("campaigns"), role);
      assert.ok(idx("campaigns") >= 0 && idx("leads") > idx("campaigns"), role);
      assert.ok(idx("reports") > idx("leads"), role);
      assert.ok(idx("support") > idx("reports"), role);
    }
  });

  it("single config array; no aria-disabled stubs in config", () => {
    assert.ok(RBAC_MENU_SECTIONS.length >= 10);
    const blob = JSON.stringify(RBAC_MENU_SECTIONS);
    assert.equal(blob.includes("aria-disabled"), false);
    assert.equal(blob.includes('"disabled":true'), false);
  });

  it("menus driven by clientMatrixAllows (same matrix as can())", () => {
    assert.equal(clientMatrixAllows("ORG_ADMIN", "billing_view"), false);
    assert.equal(clientMatrixAllows("ORG_ADMIN", "campaign_view"), true);
    assert.equal(clientMatrixAllows("AGENT", "integrations_manage"), false);
    assert.equal(clientMatrixAllows("AGENT", "recordings_view_self"), false);
    // Export requires reports_export — Owner yes, Admin item absent
    assert.equal(clientMatrixAllows("ORG_OWNER", "reports_export"), true);
  });
});

describe("Route access + friendly 403 copy", () => {
  it("Owner-only paths detected", () => {
    assert.equal(isOwnerOnlyPath("/org/billing"), true);
    assert.equal(isOwnerOnlyPath("/integrations"), true);
    assert.equal(isOwnerOnlyPath("/crm"), true);
    assert.equal(isOwnerOnlyPath("/campaigns"), false);
    assert.equal(isOwnerOnlyPath("/dashboard"), false);
  });

  it("friendly messages are plain language (no stack)", () => {
    for (const role of ["ORG_OWNER", "ORG_ADMIN", "AGENT"] as MenuRole[]) {
      const msg = friendlyAccessDeniedMessage(role);
      assert.ok(!msg.includes("Error:"));
      assert.ok(!msg.includes("\n    at "));
      assert.ok(!msg.includes("TypeError"));
      assert.ok(msg.length > 20);
    }
  });
});

describe("Keyboard / a11y contract (config)", () => {
  it("every item has aria-label source (label) and no disabled stubs", () => {
    for (const section of RBAC_MENU_SECTIONS) {
      for (const item of section.items) {
        assert.ok(item.label.trim().length > 0);
        assert.ok(item.shortLabel.trim().length > 0);
        assert.ok(item.path || item.href, `${item.id} needs path or href`);
      }
    }
  });
});
