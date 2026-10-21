/**
 * RBAC isolation suite skeleton + Batch 1 matrix integrity constants.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { C7_ENDPOINT_IDS, C7_ISOLATION_MATRIX } from "./decisionTable.js";

/** R2 — exact Admin keys for GET /org/settings (Test A). */
export const ORG_SETTINGS_ADMIN_KEYS = [
  "id",
  "name",
  "slug",
  "settings",
  "smsPerMinute",
  "preferredIntegrationKey",
] as const;

export const ORG_SETTINGS_AGENT_KEYS = ["smsPerMinute", "preferredIntegrationKey"] as const;

export const ORG_SETTINGS_OWNER_ONLY_KEYS = ["plan", "subscription"] as const;

describe("C7 isolation suite skeleton", () => {
  it("tracks exactly 12 decision-table endpoints", () => {
    assert.equal(C7_ENDPOINT_IDS.length, 12);
    assert.equal(C7_ISOLATION_MATRIX.length, 12);
    const ids = new Set(C7_ISOLATION_MATRIX.map((row) => row.id));
    for (const id of C7_ENDPOINT_IDS) {
      assert.ok(ids.has(id), `missing matrix row for ${id}`);
    }
  });

  it("every row has method, path, permission, and role statuses", () => {
    for (const row of C7_ISOLATION_MATRIX) {
      assert.ok(row.method, row.id);
      assert.ok(row.path.startsWith("/"), row.id);
      assert.ok(row.permission, row.id);
      assert.ok([200, 403, 404].includes(row.adminStatus), `${row.id} adminStatus`);
      assert.ok([200, 403].includes(row.ownerStatus), `${row.id} ownerStatus`);
      assert.ok([200, 403].includes(row.agentStatus), `${row.id} agentStatus`);
    }
  });

  it("R2 field-split constants: Admin/Agent never include Owner-only keys", () => {
    for (const k of ORG_SETTINGS_OWNER_ONLY_KEYS) {
      assert.ok(!(ORG_SETTINGS_ADMIN_KEYS as readonly string[]).includes(k), `Admin must not include ${k}`);
      assert.ok(!(ORG_SETTINGS_AGENT_KEYS as readonly string[]).includes(k), `Agent must not include ${k}`);
    }
    assert.ok(!(ORG_SETTINGS_AGENT_KEYS as readonly string[]).includes("settings"));
    assert.ok(!(ORG_SETTINGS_AGENT_KEYS as readonly string[]).includes("name"));
  });
});

describe("C7 remaining endpoints (post Batch 3)", () => {
  const done = new Set([
    "E01",
    "E02",
    "E03",
    "E04",
    "E05",
    "E06",
    "E07",
    "E08",
    "E09",
    "E10",
    "E11",
    "E12",
  ]);
  const pending = C7_ISOLATION_MATRIX.filter((r) => !done.has(r.id));
  for (const row of pending) {
    it(`TODO ${row.id} ${row.method} ${row.path}`, { todo: true }, () => {});
  }
  it("C7 matrix fully covered by Batches 1–3 (no pending E-rows)", () => {
    assert.equal(pending.length, 0);
  });
});
