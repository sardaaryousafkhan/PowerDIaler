/**
 * Canonical C7 endpoint IDs — keep in sync with docs/rbac-c7-decision-table.md.
 * Guards land only after that doc is approved.
 */
export const C7_ENDPOINT_IDS = [
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
] as const;

export type C7EndpointId = (typeof C7_ENDPOINT_IDS)[number];

export type IsolationExpectation = {
  id: C7EndpointId;
  method: string;
  path: string;
  permission: string;
  /** Expected HTTP status for ORG_ADMIN when enforce is on (happy-path in-scope where applicable). */
  adminStatus: number;
  ownerStatus: number;
  agentStatus: number;
};

/** Skeleton expectations — filled/asserted as each guard PR lands. */
export const C7_ISOLATION_MATRIX: IsolationExpectation[] = [
  {
    id: "E01",
    method: "GET",
    path: "/admin/access/users",
    permission: "members_manage",
    adminStatus: 200,
    ownerStatus: 200,
    agentStatus: 403,
  },
  {
    id: "E02",
    method: "GET",
    path: "/campaigns/:id/assignments",
    permission: "members_manage",
    adminStatus: 200,
    ownerStatus: 200,
    agentStatus: 403,
  },
  {
    id: "E03",
    method: "GET",
    path: "/org/settings",
    permission: "org_settings_read_shaped",
    /** 200 with role-shaped body — Admin exact keys in ORG_SETTINGS_ADMIN_KEYS. */
    adminStatus: 200,
    ownerStatus: 200,
    agentStatus: 200,
  },
  {
    id: "E04",
    method: "GET",
    path: "/integrations",
    permission: "integrations_manage",
    adminStatus: 403,
    ownerStatus: 200,
    agentStatus: 403,
  },
  {
    id: "E05",
    method: "GET",
    path: "/integrations/setup/:provider",
    permission: "integrations_manage",
    adminStatus: 403,
    ownerStatus: 200,
    agentStatus: 403,
  },
  {
    id: "E06",
    method: "GET",
    path: "/integrations/*/bridge-health",
    permission: "integrations_manage",
    adminStatus: 403,
    ownerStatus: 200,
    agentStatus: 403,
  },
  {
    id: "E07",
    method: "GET",
    path: "/dnc",
    permission: "dnc_manage",
    adminStatus: 200,
    ownerStatus: 200,
    agentStatus: 403,
  },
  {
    id: "E08",
    method: "GET",
    path: "/campaigns",
    permission: "campaign_view",
    adminStatus: 200,
    ownerStatus: 200,
    agentStatus: 200,
  },
  {
    id: "E09",
    method: "GET",
    path: "/crm/providers/:provider/status",
    permission: "crm_manage",
    adminStatus: 403,
    ownerStatus: 200,
    agentStatus: 403,
  },
  {
    id: "E10",
    method: "GET",
    path: "/crm/activities",
    permission: "crm_view",
    adminStatus: 200,
    ownerStatus: 200,
    agentStatus: 403,
  },
  {
    id: "E11",
    method: "POST",
    path: "/crm/contacts/upsert",
    permission: "crm_view",
    adminStatus: 200,
    ownerStatus: 200,
    agentStatus: 403,
  },
  {
    id: "E12",
    method: "POST",
    path: "/crm/activities/log",
    permission: "crm_view",
    adminStatus: 200,
    ownerStatus: 200,
    agentStatus: 403,
  },
];
