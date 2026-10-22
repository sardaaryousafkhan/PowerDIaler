import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clientMatrixAllows } from "./clientPermissionMatrix.js";

describe("clientPermissionMatrix mirrors backend enforceMatrixAllows", () => {
  it("Owner allows all sampled keys", () => {
    for (const k of [
      "billing_view",
      "integrations_manage",
      "company_settings",
      "members_invite",
      "campaign_dial",
    ] as const) {
      assert.equal(clientMatrixAllows("ORG_OWNER", k), true);
    }
  });

  it("Admin denied Owner-only; allowed team ops", () => {
    assert.equal(clientMatrixAllows("ORG_ADMIN", "billing_view"), false);
    assert.equal(clientMatrixAllows("ORG_ADMIN", "integrations_manage"), false);
    assert.equal(clientMatrixAllows("ORG_ADMIN", "company_settings"), false);
    assert.equal(clientMatrixAllows("ORG_ADMIN", "members_invite"), false);
    assert.equal(clientMatrixAllows("ORG_ADMIN", "members_change_role"), false);
    assert.equal(clientMatrixAllows("ORG_ADMIN", "campaign_dial"), false);
    assert.equal(clientMatrixAllows("ORG_ADMIN", "campaign_view"), true);
    assert.equal(clientMatrixAllows("ORG_ADMIN", "members_manage"), true);
    assert.equal(clientMatrixAllows("ORG_ADMIN", "dnc_manage"), true);
  });

  it("Agent self dial/view only", () => {
    assert.equal(clientMatrixAllows("AGENT", "campaign_view"), true);
    assert.equal(clientMatrixAllows("AGENT", "campaign_dial"), true);
    assert.equal(clientMatrixAllows("AGENT", "campaign_create"), false);
    assert.equal(clientMatrixAllows("AGENT", "billing_view"), false);
  });
});
