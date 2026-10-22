import type { FunctionPermissionKey, OrgRolePublic } from "@powerdialer/shared";

export type MenuRole = OrgRolePublic;

export type RbacMenuItem = {
  id: string;
  label: string;
  /** Route path when the item navigates in-app; omit for external/support stubs */
  path?: string;
  href?: string;
  /** Roles that see this item — single source of truth for DOM filtering */
  roles: MenuRole[];
  /** Optional permission key aligned with backend matrix (UI gate only) */
  permission?: FunctionPermissionKey;
};

export type RbacMenuSection = {
  id: string;
  label: string;
  roles: MenuRole[];
  items: RbacMenuItem[];
};

/**
 * Single menu config for Owner / Admin / Agent.
 * Overlapping items keep the same relative order across roles.
 * Render filters by role — hidden items are not mounted (no CSS hide).
 */
export const RBAC_MENU_SECTIONS: RbacMenuSection[] = [
  {
    id: "profile",
    label: "Profile / Account",
    roles: ["ORG_OWNER", "ORG_ADMIN", "AGENT"],
    items: [
      {
        id: "company-settings",
        label: "Company Settings",
        path: "/org/settings",
        roles: ["ORG_OWNER"],
        permission: "company_settings",
      },
      {
        id: "my-profile",
        label: "My Profile",
        path: "/portal/user",
        roles: ["ORG_OWNER", "ORG_ADMIN", "AGENT"],
      },
      {
        id: "change-password",
        label: "Change Password",
        path: "/portal/user",
        roles: ["ORG_OWNER", "ORG_ADMIN", "AGENT"],
      },
    ],
  },
  {
    id: "billing",
    label: "Billing & License",
    roles: ["ORG_OWNER"],
    items: [
      { id: "subscription", label: "Subscription", path: "/org/billing", roles: ["ORG_OWNER"], permission: "billing_view" },
      { id: "invoices", label: "Invoices", path: "/org/billing", roles: ["ORG_OWNER"], permission: "billing_view" },
      { id: "seat-usage", label: "Seat Usage", path: "/org/billing", roles: ["ORG_OWNER"], permission: "billing_view" },
      { id: "license", label: "License", path: "/license", roles: ["ORG_OWNER"] },
    ],
  },
  {
    id: "team-mgmt",
    label: "Team Management",
    roles: ["ORG_OWNER"],
    items: [
      { id: "users", label: "Users", path: "/portal/admin", roles: ["ORG_OWNER"], permission: "members_manage" },
      { id: "admins", label: "Admins", path: "/portal/admin", roles: ["ORG_OWNER"], permission: "members_manage" },
      { id: "roles", label: "Roles & Permissions", path: "/portal/admin", roles: ["ORG_OWNER"], permission: "members_change_role" },
      { id: "invitations", label: "Invitations", path: "/portal/admin", roles: ["ORG_OWNER"], permission: "members_invite" },
      { id: "assign-users", label: "Assign Users → Admin", path: "/portal/admin", roles: ["ORG_OWNER"], permission: "members_manage" },
    ],
  },
  {
    id: "team-admin",
    label: "Team (my users)",
    roles: ["ORG_ADMIN"],
    items: [
      { id: "my-users", label: "My Users", path: "/portal/admin", roles: ["ORG_ADMIN"], permission: "members_manage" },
      { id: "assign-leads", label: "Assign Leads/Campaigns", path: "/campaigns", roles: ["ORG_ADMIN"], permission: "members_manage" },
      { id: "user-activity", label: "View User Activity", path: "/portal/admin", roles: ["ORG_ADMIN"], permission: "members_manage" },
    ],
  },
  {
    id: "campaigns",
    label: "Campaigns",
    roles: ["ORG_OWNER", "ORG_ADMIN", "AGENT"],
    items: [
      { id: "all-campaigns", label: "All Campaigns", path: "/campaigns", roles: ["ORG_OWNER"], permission: "campaign_view" },
      { id: "my-campaigns", label: "My Campaigns", path: "/campaigns", roles: ["ORG_ADMIN", "AGENT"], permission: "campaign_view" },
      { id: "create-edit", label: "Create/Edit", path: "/new", roles: ["ORG_OWNER", "ORG_ADMIN"], permission: "campaign_create" },
      { id: "archive", label: "Create/Edit/Archive", path: "/campaigns", roles: ["ORG_OWNER"], permission: "campaign_delete" },
      { id: "assign-campaigns", label: "Assign Campaigns", path: "/campaigns", roles: ["ORG_OWNER"], permission: "members_manage" },
      { id: "assign-my-users", label: "Assign to My Users", path: "/campaigns", roles: ["ORG_ADMIN"], permission: "members_manage" },
      { id: "agent-progress", label: "Agent Progress", path: "/campaigns", roles: ["ORG_ADMIN"], permission: "campaign_view" },
      { id: "assigned-campaigns", label: "Assigned campaigns", path: "/campaigns", roles: ["AGENT"], permission: "campaign_view" },
    ],
  },
  {
    id: "leads",
    label: "Leads / Contacts",
    roles: ["ORG_OWNER", "ORG_ADMIN", "AGENT"],
    items: [
      { id: "all-contacts", label: "All Contacts", path: "/campaigns", roles: ["ORG_OWNER"], permission: "campaign_view" },
      { id: "team-contacts", label: "My Team's Contacts", path: "/campaigns", roles: ["ORG_ADMIN"], permission: "campaign_view" },
      { id: "my-leads", label: "My contacts", path: "/campaigns", roles: ["AGENT"], permission: "campaign_view" },
      { id: "import-export", label: "Import/Export", path: "/campaigns", roles: ["ORG_OWNER"], permission: "contact_import" },
      { id: "import", label: "Import", path: "/campaigns", roles: ["ORG_ADMIN"], permission: "contact_import" },
      { id: "dnc-mgmt", label: "DNC Management", path: "/dnc", roles: ["ORG_OWNER"], permission: "dnc_manage" },
      { id: "dnc-team", label: "DNC (view/add)", path: "/dnc", roles: ["ORG_ADMIN"], permission: "dnc_manage" },
      { id: "dnc-requests", label: "DNC requests", path: "/dnc", roles: ["AGENT"] },
    ],
  },
  {
    id: "reports",
    label: "Reports & Analytics",
    roles: ["ORG_OWNER", "ORG_ADMIN", "AGENT"],
    items: [
      { id: "global-dash", label: "Global Dashboard", path: "/dashboard", roles: ["ORG_OWNER"] },
      { id: "team-perf", label: "Team Performance", path: "/dashboard", roles: ["ORG_ADMIN"] },
      { id: "my-stats", label: "Talk time / connect rate", path: "/dashboard", roles: ["AGENT"] },
      { id: "call-logs", label: "Call Logs", path: "/dashboard", roles: ["ORG_ADMIN"] },
      { id: "recordings", label: "Call Recordings", path: "/dashboard", roles: ["ORG_OWNER"] },
      { id: "my-recordings", label: "My recordings", path: "/dashboard", roles: ["AGENT"] },
    ],
  },
  {
    id: "integrations",
    label: "Integrations",
    roles: ["ORG_OWNER"],
    items: [
      { id: "crm", label: "CRM", path: "/crm", roles: ["ORG_OWNER"], permission: "crm_manage" },
      { id: "webhooks", label: "Webhooks", path: "/integrations", roles: ["ORG_OWNER"], permission: "integrations_manage" },
      { id: "api-keys", label: "API Keys", path: "/integrations", roles: ["ORG_OWNER"], permission: "integrations_manage" },
      { id: "telephony", label: "Telephony Provider", path: "/integrations", roles: ["ORG_OWNER"], permission: "integrations_manage" },
    ],
  },
  {
    id: "compliance",
    label: "Compliance",
    roles: ["ORG_OWNER"],
    items: [
      { id: "recording-policy", label: "Recording Policy", path: "/org/settings", roles: ["ORG_OWNER"], permission: "company_settings" },
      { id: "consent", label: "Consent", path: "/org/settings", roles: ["ORG_OWNER"], permission: "company_settings" },
      { id: "retention", label: "Retention", path: "/org/settings", roles: ["ORG_OWNER"], permission: "company_settings" },
      { id: "audit-log", label: "Audit Log", path: "/portal/admin", roles: ["ORG_OWNER"], permission: "audit_view" },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    roles: ["ORG_OWNER", "AGENT"],
    items: [
      { id: "global-dialer", label: "Global Dialer", path: "/org/settings", roles: ["ORG_OWNER"], permission: "company_settings" },
      { id: "my-settings", label: "Audio, notifications, hotkeys", path: "/dashboard/settings", roles: ["AGENT"] },
    ],
  },
  {
    id: "support",
    label: "Support",
    roles: ["ORG_OWNER", "ORG_ADMIN", "AGENT"],
    items: [
      { id: "help", label: "Help Center", href: "https://derivedstudio.com/help", roles: ["ORG_OWNER", "ORG_ADMIN", "AGENT"] },
      { id: "contact-support", label: "Contact Support", href: "mailto:support@derivedstudio.com", roles: ["ORG_OWNER", "ORG_ADMIN", "AGENT"] },
      { id: "system-status", label: "System Status", href: "https://derivedstudio.com/status", roles: ["ORG_OWNER"] },
    ],
  },
];

export function menuForRole(role: MenuRole): RbacMenuSection[] {
  return RBAC_MENU_SECTIONS.filter((s) => s.roles.includes(role))
    .map((s) => ({
      ...s,
      items: s.items.filter((i) => i.roles.includes(role)),
    }))
    .filter((s) => s.items.length > 0);
}

/** Overlapping item labels that must keep identical order across roles. */
export function overlappingItemOrder(roleA: MenuRole, roleB: MenuRole): { a: string[]; b: string[] } {
  const labelsA = menuForRole(roleA).flatMap((s) => s.items.map((i) => i.label));
  const labelsB = menuForRole(roleB).flatMap((s) => s.items.map((i) => i.label));
  const overlap = labelsA.filter((l) => labelsB.includes(l));
  return {
    a: labelsA.filter((l) => overlap.includes(l)),
    b: labelsB.filter((l) => overlap.includes(l)),
  };
}
