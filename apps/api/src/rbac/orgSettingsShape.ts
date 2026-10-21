import type { OrgRolePublic } from "@powerdialer/shared";

export type OrgSettingsFull = {
  id: string;
  name: string;
  slug: string;
  settings: Record<string, unknown>;
  smsPerMinute: number;
  preferredIntegrationKey: string;
  plan: { name: string; slug: string; seatLimit: number } | null;
  subscription: { status: string; currentPeriodEnd: Date | string | null } | null;
};

/** Exact Admin shape for Test A (plan/subscription omitted — Owner-only). */
export type OrgSettingsAdminShape = {
  id: string;
  name: string;
  slug: string;
  settings: { timezone?: string };
  smsPerMinute: number;
  preferredIntegrationKey: string;
};

/** Exact Agent member-safe shape for Test A. */
export type OrgSettingsAgentShape = {
  smsPerMinute: number;
  preferredIntegrationKey: string;
};

export function shapeOrgSettingsForRole(
  full: OrgSettingsFull,
  orgRole: OrgRolePublic,
): OrgSettingsFull | OrgSettingsAdminShape | OrgSettingsAgentShape {
  if (orgRole === "ORG_OWNER") {
    return full;
  }
  if (orgRole === "ORG_ADMIN") {
    const timezone =
      typeof full.settings?.timezone === "string" ? full.settings.timezone : undefined;
    const admin: OrgSettingsAdminShape = {
      id: full.id,
      name: full.name,
      slug: full.slug,
      settings: timezone !== undefined ? { timezone } : {},
      smsPerMinute: full.smsPerMinute,
      preferredIntegrationKey: full.preferredIntegrationKey,
    };
    return admin;
  }
  const agent: OrgSettingsAgentShape = {
    smsPerMinute: full.smsPerMinute,
    preferredIntegrationKey: full.preferredIntegrationKey,
  };
  return agent;
}
