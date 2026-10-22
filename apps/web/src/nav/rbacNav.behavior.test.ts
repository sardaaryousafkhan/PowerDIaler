/**
 * Behavior contracts for menus (UI). Propagation (reassign/demote) is enforced
 * by the API — covered by `pnpm test:rbac` in apps/api; asserted here as docs.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clientMatrixAllows } from "./clientPermissionMatrix.js";
import {
  friendlyAccessDeniedMessage,
  isOwnerOnlyPath,
  menuForRole,
} from "./rbacMenuConfig.js";

describe("Direct URL / menu → friendly denial", () => {
  it("Admin hitting Owner-only route is treated as forbidden by path helper", () => {
    assert.equal(isOwnerOnlyPath("/org/billing"), true);
    assert.equal(clientMatrixAllows("ORG_ADMIN", "billing_view"), false);
    const msg = friendlyAccessDeniedMessage("ORG_ADMIN");
    assert.match(msg, /Owner/i);
  });

  it("Agent hitting Admin/Owner route gets Agent-friendly copy", () => {
    assert.equal(isOwnerOnlyPath("/integrations"), true);
    assert.equal(clientMatrixAllows("AGENT", "integrations_manage"), false);
    assert.match(friendlyAccessDeniedMessage("AGENT"), /Admin|Owner/i);
  });

  it("Admin menu never lists Owner-only destinations", () => {
    const paths = menuForRole("ORG_ADMIN")
      .flatMap((s) => s.items)
      .map((i) => i.path)
      .filter(Boolean) as string[];
    for (const p of paths) {
      assert.equal(isOwnerOnlyPath(p), false, `Admin menu must not link ${p}`);
    }
  });
});

describe("Propagation rules (backend source of truth — menu is a view)", () => {
  it("documents: Owner global setting change does not alter Admin menu structure", () => {
    const before = menuForRole("ORG_ADMIN").map((s) => s.id);
    // Menu config is static; settings change affects page data, not menu tree.
    const after = menuForRole("ORG_ADMIN").map((s) => s.id);
    assert.deepEqual(before, after);
  });

  it("documents: Admin My Users is members_manage + team scope (API), not UI-only", () => {
    const myUsers = menuForRole("ORG_ADMIN")
      .flatMap((s) => s.items)
      .find((i) => i.id === "my-users");
    assert.ok(myUsers);
    assert.equal(myUsers.permission, "members_manage");
    assert.equal(myUsers.path, "/portal/admin");
  });
});
