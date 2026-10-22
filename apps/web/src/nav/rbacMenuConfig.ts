import type { FunctionPermissionKey, OrgRolePublic } from "@powerdialer/shared";
import { clientMatrixAllows } from "./clientPermissionMatrix.js";

export type MenuRole = OrgRolePublic;

export type RbacMenuItem = {
  id: string;
  label: string;
  /** Short label for icon-only / compact rail */
  shortLabel: string;
  path?: string;
  href?: string;
  /** Roles that include this item in their filtered menu (DOM source) */
  roles: MenuRole[];
  /**
   * Permission key from the shared backend matrix.
   * When set, item is omitted unless clientMatrixAllows(role, permission).
   */
  permission?: FunctionPermissionKey;
};

export type RbacMenuSection = {
  id: string;
  label: string;
  /** Section order family for cross-role overlap tests */
  orderKey:
    | "profile"
    | "billing"
    | "team"
    | "campaigns"
    | "leads"
    | "reports"
    | "integrations"
    | "compliance"
    | "settings"
    | "support";
  roles: MenuRole[];
  items: RbacMenuItem[];
};

/**
 * Single menu config for Owner / Admin / Agent.
 * Filter at render with menuForRole — never mount hidden items.
 * Section order: Profile → Team → Campaigns → Leads → Reports → Settings → Support
 * (Owner inserts Billing / Integrations / Compliance in their natural places.)
 */
export const RBAC_MENU_SECTIONS: RbacMenuSection[] = [
  {
    id: "profile",
    label: "Profile / Account",
    orderKey: "profile",
    roles: ["ORG_OWNER", "ORG_ADMIN", "AGENT"],
    items: [
      {
        id: "company-settings",
        label: "Company Settings",
        shortLabel: "Co",
        path: "/org/settings",
        roles: ["ORG_OWNER"],
        permission: "company_settings",
      },
      {
        id: "my-profile",
        label: "My Profile",
        shortLabel: "Me",
        path: "/portal/user",
        roles: ["ORG_OWNER", "ORG_ADMIN", "AGENT"],
      },
      {
        id: "change-password",
        label: "Change Password",
        shortLabel: "Pw",
        path: "/portal/user",
        roles: ["ORG_OWNER", "ORG_ADMIN", "AGENT"],
      },
    ],
  },
  {
    id: "billing",
    label: "Billing & License",
    orderKey: "billing",
    roles: ["ORG_OWNER"],
    items: [
      {
        id: "subscription",
        label: "Subscription",
        shortLabel: "Sub",
        path: "/org/billing",
        roles: ["ORG_OWNER"],
        permission: "billing_view",
      },
      {
        id: "invoices",
        label: "Invoices",
        shortLabel: "Inv",
        path: "/org/billing",
        roles: ["ORG_OWNER"],
        permission: "billing_view",
      },
      {
        id: "seat-usage",
        label: "Seat Usage",
        shortLabel: "Seat",
        path: "/org/billing",
        roles: ["ORG_OWNER"],
        permission: "billing_view",
      },
    ],
  },
  {
    id: "team-owner",
    label: "Team Management",
    orderKey: "team",
    roles: ["ORG_OWNER"],
    items: [
      {
        id: "users",
        label: "Users",
        shortLabel: "Usr",
        path: "/portal/admin",
        roles: ["ORG_OWNER"],
        permission: "members_manage",
      },
      {
        id: "admins",
        label: "Admins",
        shortLabel: "Adm",
        path: "/portal/admin",
        roles: ["ORG_OWNER"],
        permission: "members_manage",
      },
      {
        id: "roles",
        label: "Roles & Permissions",
        shortLabel: "Role",
        path: "/portal/admin",
        roles: ["ORG_OWNER"],
        permission: "members_change_role",
      },
      {
        id: "invitations",
        label: "Invitations",
        shortLabel: "Inv",
        path: "/portal/admin",
        roles: ["ORG_OWNER"],
        permission: "members_invite",
      },
      {
        id: "assign-users",
        label: "Assign Users → Admin",
        shortLabel: "Asg",
        path: "/portal/admin",
        roles: ["ORG_OWNER"],
        permission: "members_manage",
      },
    ],
  },
  {
    id: "team-admin",
    label: "Team (my users)",
    orderKey: "team",
    roles: ["ORG_ADMIN"],
    items: [
      {
        id: "my-users",
        label: "My Users",
        shortLabel: "Usr",
        path: "/portal/admin",
        roles: ["ORG_ADMIN"],
        permission: "members_manage",
      },
      {
        id: "assign-leads",
        label: "Assign Leads / Campaigns",
        shortLabel: "Asg",
        path: "/campaigns",
        roles: ["ORG_ADMIN"],
        permission: "members_manage",
      },
      {
        id: "user-activity",
        label: "View User Activity",
        shortLabel: "Act",
        path: "/portal/admin",
        roles: ["ORG_ADMIN"],
        permission: "members_manage",
      },
    ],
  },
  {
    id: "campaigns-owner",
    label: "Campaigns",
    orderKey: "campaigns",
    roles: ["ORG_OWNER"],
    items: [
      {
        id: "all-campaigns",
        label: "All Campaigns",
        shortLabel: "All",
        path: "/campaigns",
        roles: ["ORG_OWNER"],
        permission: "campaign_view",
      },
      {
        id: "create-edit-archive",
        label: "Create / Edit / Archive",
        shortLabel: "New",
        path: "/new",
        roles: ["ORG_OWNER"],
        permission: "campaign_create",
      },
      {
        id: "assign-campaigns",
        label: "Assign Campaigns",
        shortLabel: "Asg",
        path: "/campaigns",
        roles: ["ORG_OWNER"],
        permission: "members_manage",
      },
    ],
  },
  {
    id: "campaigns-admin",
    label: "Campaigns (my scope)",
    orderKey: "campaigns",
    roles: ["ORG_ADMIN"],
    items: [
      {
        id: "my-campaigns",
        label: "My Campaigns",
        shortLabel: "Mine",
        path: "/campaigns",
        roles: ["ORG_ADMIN"],
        permission: "campaign_view",
      },
      {
        id: "create-edit",
        label: "Create / Edit",
        shortLabel: "New",
        path: "/new",
        roles: ["ORG_ADMIN"],
        permission: "campaign_create",
      },
      {
        id: "assign-my-users",
        label: "Assign to My Users",
        shortLabel: "Asg",
        path: "/campaigns",
        roles: ["ORG_ADMIN"],
        permission: "members_manage",
      },
      {
        id: "agent-progress",
        label: "Agent Progress",
        shortLabel: "Prog",
        path: "/campaigns",
        roles: ["ORG_ADMIN"],
        permission: "campaign_view",
      },
    ],
  },
  {
    id: "campaigns-agent",
    label: "My Campaigns",
    orderKey: "campaigns",
    roles: ["AGENT"],
    items: [
      {
        id: "assigned-campaigns",
        label: "Assigned campaigns",
        shortLabel: "Mine",
        path: "/campaigns",
        roles: ["AGENT"],
        permission: "campaign_view",
      },
      {
        id: "list-progress",
        label: "List progress",
        shortLabel: "Prog",
        path: "/campaigns",
        roles: ["AGENT"],
        permission: "campaign_view",
      },
    ],
  },
  {
    id: "leads-owner",
    label: "Leads / Contacts",
    orderKey: "leads",
    roles: ["ORG_OWNER"],
    items: [
      {
        id: "all-contacts",
        label: "All Contacts",
        shortLabel: "All",
        path: "/campaigns",
        roles: ["ORG_OWNER"],
        permission: "campaign_view",
      },
      {
        id: "import-export",
        label: "Import / Export",
        shortLabel: "Imp",
        path: "/campaigns",
        roles: ["ORG_OWNER"],
        permission: "contact_import",
      },
      {
        id: "list-assignment",
        label: "List Assignment",
        shortLabel: "List",
        path: "/campaigns",
        roles: ["ORG_OWNER"],
        permission: "members_manage",
      },
      {
        id: "dnc-mgmt",
        label: "DNC Management",
        shortLabel: "DNC",
        path: "/dnc",
        roles: ["ORG_OWNER"],
        permission: "dnc_manage",
      },
    ],
  },
  {
    id: "leads-admin",
    label: "Leads / Contacts (my scope)",
    orderKey: "leads",
    roles: ["ORG_ADMIN"],
    items: [
      {
        id: "team-contacts",
        label: "My Team's Contacts",
        shortLabel: "Team",
        path: "/campaigns",
        roles: ["ORG_ADMIN"],
        permission: "campaign_view",
      },
      {
        id: "import",
        label: "Import",
        shortLabel: "Imp",
        path: "/campaigns",
        roles: ["ORG_ADMIN"],
        permission: "contact_import",
      },
      {
        id: "assign-contacts",
        label: "Assign to My Users",
        shortLabel: "Asg",
        path: "/campaigns",
        roles: ["ORG_ADMIN"],
        permission: "members_manage",
      },
      {
        id: "dnc-team",
        label: "DNC (view / add)",
        shortLabel: "DNC",
        path: "/dnc",
        roles: ["ORG_ADMIN"],
        permission: "dnc_manage",
      },
    ],
  },
  {
    id: "leads-agent",
    label: "My Leads",
    orderKey: "leads",
    roles: ["AGENT"],
    items: [
      {
        id: "my-leads",
        label: "My contacts",
        shortLabel: "Lead",
        path: "/campaigns",
        roles: ["AGENT"],
        permission: "campaign_view",
      },
      {
        id: "callbacks",
        label: "Callbacks",
        shortLabel: "Cb",
        path: "/campaigns",
        roles: ["AGENT"],
        permission: "campaign_view",
      },
      {
        id: "dnc-requests",
        label: "DNC requests",
        shortLabel: "DNC",
        path: "/dnc",
        roles: ["AGENT"],
      },
    ],
  },
  {
    id: "reports-owner",
    label: "Reports",
    orderKey: "reports",
    roles: ["ORG_OWNER"],
    items: [
      {
        id: "global-dash",
        label: "Global Dashboard",
        shortLabel: "Dash",
        path: "/dashboard",
        roles: ["ORG_OWNER"],
        permission: "campaign_view",
      },
      {
        id: "per-admin",
        label: "Per-Admin",
        shortLabel: "Adm",
        path: "/dashboard",
        roles: ["ORG_OWNER"],
        permission: "campaign_view",
      },
      {
        id: "per-user",
        label: "Per-User",
        shortLabel: "Usr",
        path: "/dashboard",
        roles: ["ORG_OWNER"],
        permission: "campaign_view",
      },
      {
        id: "call-recordings",
        label: "Call Recordings",
        shortLabel: "Rec",
        path: "/dashboard",
        roles: ["ORG_OWNER"],
        permission: "campaign_view",
      },
      {
        id: "export",
        label: "Export",
        shortLabel: "Exp",
        path: "/dashboard",
        roles: ["ORG_OWNER"],
        permission: "reports_export",
      },
    ],
  },
  {
    id: "reports-admin",
    label: "Reports (my scope)",
    orderKey: "reports",
    roles: ["ORG_ADMIN"],
    items: [
      {
        id: "team-perf",
        label: "Team Performance",
        shortLabel: "Perf",
        path: "/dashboard",
        roles: ["ORG_ADMIN"],
        permission: "campaign_view",
      },
      {
        id: "call-logs",
        label: "Call Logs",
        shortLabel: "Log",
        path: "/dashboard",
        roles: ["ORG_ADMIN"],
        permission: "campaign_view",
      },
      {
        id: "recordings-admin",
        label: "Recordings",
        shortLabel: "Rec",
        path: "/dashboard",
        roles: ["ORG_ADMIN"],
        permission: "campaign_view",
      },
    ],
  },
  {
    id: "reports-agent",
    label: "My Stats",
    orderKey: "reports",
    roles: ["AGENT"],
    items: [
      {
        id: "my-stats",
        label: "Talk time, connect rate, calls today, goal",
        shortLabel: "Stat",
        path: "/dashboard",
        roles: ["AGENT"],
        permission: "campaign_view",
      },
      {
        id: "my-recordings",
        label: "My recordings",
        shortLabel: "Rec",
        path: "/dashboard",
        roles: ["AGENT"],
        permission: "recordings_view_self",
      },
    ],
  },
  {
    id: "integrations",
    label: "Integrations",
    orderKey: "integrations",
    roles: ["ORG_OWNER"],
    items: [
      {
        id: "crm",
        label: "CRM",
        shortLabel: "CRM",
        path: "/crm",
        roles: ["ORG_OWNER"],
        permission: "crm_manage",
      },
      {
        id: "webhooks",
        label: "Webhooks",
        shortLabel: "Hook",
        path: "/integrations",
        roles: ["ORG_OWNER"],
        permission: "integrations_manage",
      },
      {
        id: "api-keys",
        label: "API Keys",
        shortLabel: "Key",
        path: "/integrations",
        roles: ["ORG_OWNER"],
        permission: "integrations_manage",
      },
      {
        id: "telephony",
        label: "Telephony Provider",
        shortLabel: "Tel",
        path: "/integrations",
        roles: ["ORG_OWNER"],
        permission: "integrations_manage",
      },
    ],
  },
  {
    id: "compliance",
    label: "Compliance",
    orderKey: "compliance",
    roles: ["ORG_OWNER"],
    items: [
      {
        id: "recording-policy",
        label: "Recording Policy",
        shortLabel: "Pol",
        path: "/org/settings",
        roles: ["ORG_OWNER"],
        permission: "company_settings",
      },
      {
        id: "consent",
        label: "Consent",
        shortLabel: "Con",
        path: "/org/settings",
        roles: ["ORG_OWNER"],
        permission: "company_settings",
      },
      {
        id: "retention",
        label: "Retention",
        shortLabel: "Ret",
        path: "/org/settings",
        roles: ["ORG_OWNER"],
        permission: "company_settings",
      },
      {
        id: "audit-log",
        label: "Audit Log",
        shortLabel: "Aud",
        path: "/portal/admin",
        roles: ["ORG_OWNER"],
        permission: "audit_view",
      },
    ],
  },
  {
    id: "settings-owner",
    label: "Settings",
    orderKey: "settings",
    roles: ["ORG_OWNER"],
    items: [
      {
        id: "global-dialer",
        label: "Global Dialer",
        shortLabel: "Dial",
        path: "/org/settings",
        roles: ["ORG_OWNER"],
        permission: "company_settings",
      },
      {
        id: "caller-ids",
        label: "Caller IDs",
        shortLabel: "CID",
        path: "/org/settings",
        roles: ["ORG_OWNER"],
        permission: "company_settings",
      },
      {
        id: "business-hours",
        label: "Business Hours",
        shortLabel: "Hrs",
        path: "/org/settings",
        roles: ["ORG_OWNER"],
        permission: "company_settings",
      },
      {
        id: "number-pool",
        label: "Number Pool",
        shortLabel: "Pool",
        path: "/org/settings",
        roles: ["ORG_OWNER"],
        permission: "company_settings",
      },
    ],
  },
  {
    id: "settings-agent",
    label: "My Settings",
    orderKey: "settings",
    roles: ["AGENT"],
    items: [
      {
        id: "my-settings",
        label: "Audio, notifications, hotkeys",
        shortLabel: "Set",
        path: "/dashboard/settings",
        roles: ["AGENT"],
      },
    ],
  },
  {
    id: "support",
    label: "Support",
    orderKey: "support",
    roles: ["ORG_OWNER", "ORG_ADMIN", "AGENT"],
    items: [
      {
        id: "help",
        label: "Help Center",
        shortLabel: "Help",
        href: "https://derivedstudio.com/help",
        roles: ["ORG_OWNER", "ORG_ADMIN", "AGENT"],
      },
      {
        id: "contact-support",
        label: "Contact Support",
        shortLabel: "Sup",
        href: "mailto:support@derivedstudio.com",
        roles: ["ORG_OWNER", "ORG_ADMIN"],
      },
      {
        id: "system-status",
        label: "System Status",
        shortLabel: "Stat",
        href: "https://derivedstudio.com/status",
        roles: ["ORG_OWNER"],
      },
    ],
  },
];

/** Owner-only routes used for direct-URL guards (friendly 403 UI). */
export const OWNER_ONLY_PATH_PREFIXES = [
  "/org/billing",
  "/org/settings",
  "/integrations",
  "/crm",
] as const;

export function menuForRole(role: MenuRole): RbacMenuSection[] {
  return RBAC_MENU_SECTIONS.filter((s) => s.roles.includes(role))
    .map((s) => ({
      ...s,
      items: s.items.filter((i) => {
        if (!i.roles.includes(role)) return false;
        if (i.permission && !clientMatrixAllows(role, i.permission)) return false;
        return true;
      }),
    }))
    .filter((s) => s.items.length > 0);
}

/** Labels of items that appear for both roles, in each role's menu order. */
export function overlappingItemOrder(roleA: MenuRole, roleB: MenuRole): { a: string[]; b: string[] } {
  const labelsA = menuForRole(roleA).flatMap((s) => s.items.map((i) => i.label));
  const labelsB = menuForRole(roleB).flatMap((s) => s.items.map((i) => i.label));
  const overlap = new Set(labelsA.filter((l) => labelsB.includes(l)));
  return {
    a: labelsA.filter((l) => overlap.has(l)),
    b: labelsB.filter((l) => overlap.has(l)),
  };
}

/** Section orderKeys present for a role (for Profile→…→Support order asserts). */
export function sectionOrderKeys(role: MenuRole): string[] {
  return menuForRole(role).map((s) => s.orderKey);
}

export function resolveMenuRole(
  orgRole: string | undefined | null,
  legacyRole: string | undefined,
): MenuRole {
  if (orgRole === "ORG_OWNER" || orgRole === "ORG_ADMIN" || orgRole === "AGENT") return orgRole;
  if (legacyRole === "owner") return "ORG_OWNER";
  if (legacyRole === "admin") return "ORG_ADMIN";
  return "AGENT";
}

export function isOwnerOnlyPath(pathname: string): boolean {
  return OWNER_ONLY_PATH_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export function friendlyAccessDeniedMessage(role: MenuRole): string {
  if (role === "AGENT") {
    return "You don't have access to that page. It is only available to Admins or Owners.";
  }
  if (role === "ORG_ADMIN") {
    return "You don't have access to that page. Ask your Owner if you need billing, integrations, or company-wide settings.";
  }
  return "You don't have access to that page.";
}
