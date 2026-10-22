import { FUNCTION_PERMISSION_KEYS, type FunctionPermissionKey } from "@powerdialer/shared";
import { readAuthToken } from "./authStore.js";

const base = "/api";

function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  try {
    const token = readAuthToken();
    if (token) headers.set("authorization", `Bearer ${token}`);
  } catch {
    // ignore localStorage access issues
  }
  return fetch(`${base}${path}`, { ...init, headers });
}

async function handle<T>(res: Promise<Response> | Response): Promise<T> {
  const r = await res;
  const text = await r.text();
  if (!r.ok) {
    if (r.status === 402 && typeof window !== "undefined") {
      // Desktop license gate refused a paid action; let the license banner refresh.
      window.dispatchEvent(new CustomEvent("dashdialer:license-required"));
    }
    let parsed: { error?: unknown; message?: unknown; details?: unknown } | null = null;
    try {
      parsed = JSON.parse(text) as { error?: unknown; message?: unknown; details?: unknown };
    } catch {}
    const msg =
      (parsed && typeof parsed.message === "string" && parsed.message) ||
      (parsed && typeof parsed.error === "string" && parsed.error) ||
      (parsed && typeof parsed.details === "string" && parsed.details) ||
      text ||
      r.statusText;
    if (r.status === 403 && typeof window !== "undefined") {
      // Friendly toast via ApiForbiddenListener — never surface a stack trace.
      window.dispatchEvent(
        new CustomEvent("dashdialer:api-forbidden", {
          detail: { message: String(msg || ""), path: r.url },
        }),
      );
    }
    throw new Error(msg || `Request failed (${r.status})`);
  }
  if (!text.length) return {} as T;
  return JSON.parse(text) as T;
}

export type UserWorkspaceSettings = {
  theme: "system" | "dark" | "light";
  showDashboardWelcome: boolean;
  logDetailLevel: "summary" | "normal" | "verbose";
};

/** Must stay in sync with API `DEFAULT_SETTINGS` in `apps/api/src/routes/me.ts`. */
export const DEFAULT_USER_WORKSPACE_SETTINGS: UserWorkspaceSettings = {
  theme: "light",
  showDashboardWelcome: true,
  logDetailLevel: "normal",
};

export type UserFunctionAccess = Record<FunctionPermissionKey, boolean>;

export const DEFAULT_USER_FUNCTION_ACCESS: UserFunctionAccess = Object.fromEntries(
  FUNCTION_PERMISSION_KEYS.map((k) => [k, true]),
) as UserFunctionAccess;

export type AuthOrganization = {
  id: string;
  name: string;
  slug: string;
  orgRole: string;
  membershipId: string;
};

export type AuthSessionPayload = {
  token?: string;
  user: { id: string; name: string; email: string; role: "user" | "admin" | "owner" };
  organization?: AuthOrganization | null;
  permissions?: UserFunctionAccess;
};

export type OrgSettingsPayload = {
  id: string;
  name: string;
  slug: string;
  settings: Record<string, unknown>;
  smsPerMinute: number;
  preferredIntegrationKey: string;
  plan: { name: string; slug: string; seatLimit: number } | null;
  subscription: { status: string; currentPeriodEnd: string | null } | null;
};

export type OrgBillingPayload = {
  subscription: {
    status: string;
    plan: { name: string; slug: string; seatLimit: number; smsMonthlyCap: number };
  } | null;
  seatsUsed: number;
  seatLimit: number;
  stripeCheckoutEnabled: boolean;
  message: string;
};

export type MeDashboardPayload = {
  user: { id: string; name: string; email: string; role: "user" | "admin" | "owner"; memberSince: string };
  settings: UserWorkspaceSettings;
  summary: {
    campaignsTotal: number;
    campaignsRunning: number;
    contactsTotal: number;
    callsTotal: number;
    smsTotal: number;
  };
  callsByDisposition: Record<string, number>;
  smsByStatus: Record<string, number>;
  campaigns: Array<{
    id: string;
    name: string;
    kind: string;
    status: string;
    updatedAt: string;
    _count: { contacts: number; callAttempts: number; smsAttempts: number };
  }>;
  activity: Array<{
    kind: "call" | "sms" | "webhook";
    id: string;
    at: string;
    label: string;
    detail: string;
    campaignId: string | null;
  }>;
  webhookEvents: Array<{ id: string; at: string; provider: string; type: string }>;
};

export type AdminAccessUserRow = {
  id: string;
  membershipId?: string;
  name: string;
  email: string;
  role: "user" | "admin" | "owner";
  orgRole?: string;
  createdAt: string;
  permissions: UserFunctionAccess;
};

export const api = {
  auth: {
    register: (input: {
      name: string;
      email: string;
      password: string;
      adminCode?: string;
      companyName?: string;
    }) =>
      handle<AuthSessionPayload>(
        apiFetch("/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }),
      ),
    login: (email: string, password: string) =>
      handle<AuthSessionPayload>(
        apiFetch("/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        }),
      ),
    registerCompany: (input: { name: string; email: string; password: string; companyName: string }) =>
      handle<AuthSessionPayload>(
        apiFetch("/auth/register-company", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }),
      ),
    acceptInvite: (input: { token: string; name?: string; password?: string }) =>
      handle<AuthSessionPayload>(
        apiFetch("/auth/accept-invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }),
      ),
    me: () => handle<AuthSessionPayload>(apiFetch("/auth/me")),
    logout: () => handle<{ ok: boolean }>(apiFetch("/auth/logout", { method: "POST" })),
  },
  org: {
    settings: () => handle<OrgSettingsPayload>(apiFetch("/org/settings")),
    patchSettings: (body: { name?: string; settings?: Record<string, unknown>; smsPerMinute?: number }) =>
      handle<{ ok: boolean }>(
        apiFetch("/org/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      ),
    billing: () => handle<OrgBillingPayload>(apiFetch("/org/billing")),
    invites: () => handle<{ invites: Array<Record<string, unknown>> }>(apiFetch("/org/invites")),
    createInvite: (body: { email: string; orgRole?: string }) =>
      handle<{ token: string; acceptPath: string; email: string }>(
        apiFetch("/org/invites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      ),
    auditLogs: () => handle<{ logs: Array<Record<string, unknown>> }>(apiFetch("/org/audit-logs")),
    createMember: (body: { name: string; email: string; orgRole?: string; password?: string }) =>
      handle<{
        id: string;
        membershipId: string;
        name: string;
        email: string;
        orgRole: string;
        temporaryPassword: string | null;
      }>(
        apiFetch("/org/members", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      ),
    removeMember: (userId: string) =>
      handle<{ ok: boolean }>(
        apiFetch(`/org/members/${encodeURIComponent(userId)}`, { method: "DELETE" }),
      ),
    getAssignments: (campaignId: string) =>
      handle<{ assignments: Array<{ userId: string; user: { id: string; name: string; email: string } }> }>(
        apiFetch(`/campaigns/${encodeURIComponent(campaignId)}/assignments`),
      ),
    setAssignments: (campaignId: string, userIds: string[]) =>
      handle<{ ok: boolean }>(
        apiFetch(`/campaigns/${encodeURIComponent(campaignId)}/assignments`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userIds }),
        }),
      ),
  },
  health: () => handle<{ ok: boolean }>(apiFetch("/health")),
  adminAccess: {
    listUsers: () => handle<{ users: AdminAccessUserRow[] }>(apiFetch("/admin/access/users")),
    patchUser: (id: string, permissions: Partial<UserFunctionAccess>, orgRole?: string) =>
      handle<{ ok: boolean; userId: string; orgRole: string; permissions: UserFunctionAccess }>(
        apiFetch(`/admin/access/users/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ permissions, ...(orgRole ? { orgRole } : {}) }),
        }),
      ),
  },
  integrations: {
    get: () =>
      handle<{
        catalog: {
          id: string;
          name: string;
          tagline: string;
          category: string;
          capabilities: string[];
          websiteUrl: string;
          adapterStatus: "live" | "open_connector";
        }[];
        preference: {
          preferredIntegrationKey: string;
          smsPerMinute: number;
          updatedAt: string;
        };
      }>(apiFetch("/integrations")),
    setPreference: (patch: { preferredIntegrationKey?: string; smsPerMinute?: number }) =>
      handle<{ preferredIntegrationKey: string; smsPerMinute: number; updatedAt: string }>(
        apiFetch("/integrations/preference", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        }),
      ),
    getProviderSetup: (provider: string) =>
      handle<{
        provider: string;
        requiresSetup: boolean;
        configured: boolean;
        message?: string;
        help?: string;
        fields: {
          key: string;
          label: string;
          kind: "text" | "password" | "url";
          required: boolean;
          hasValue: boolean;
          valueMask: string;
        }[];
      }>(apiFetch(`/integrations/setup/${encodeURIComponent(provider)}`)),
    googleVoiceBridgeHealth: () =>
      handle<{
        ok: boolean;
        googleAuth: string;
        googleVoiceReady: boolean;
        smsEnabled: boolean;
        mode?: string;
        error?: string;
      }>(apiFetch("/integrations/google_voice/bridge-health")),
    zoomBridgeHealth: () =>
      handle<{
        ok: boolean;
        zoomAuth: string;
        zoomUserPhoneLicense: boolean;
        smsEnabled: boolean;
        mode?: string;
        agentDial?: boolean;
        message?: string;
        error?: string;
      }>(apiFetch("/integrations/zoom_phone/bridge-health")),
    saveProviderSetup: (provider: string, values: Record<string, string>) =>
      handle<{
        ok: boolean;
        provider: string;
        configured: boolean;
        fields: {
          key: string;
          label: string;
          kind: "text" | "password" | "url";
          required: boolean;
          hasValue: boolean;
          valueMask: string;
        }[];
      }>(
        apiFetch(`/integrations/setup/${encodeURIComponent(provider)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ values }),
        }),
      ),
  },
  crm: {
    providerStatus: (provider: string) =>
      handle<{ provider: string; configured: boolean; mode: "bridge" | "built_in" }>(
        apiFetch(`/crm/providers/${encodeURIComponent(provider)}/status`),
      ),
    activities: (provider?: string, limit = 50) => {
      const qp = new URLSearchParams();
      if (provider) qp.set("provider", provider);
      qp.set("limit", String(limit));
      return handle<{
        items: Array<{
          id: string;
          provider: string;
          type: "call" | "sms" | "note";
          status: string | null;
          summary: string;
          createdAt: string;
        }>;
      }>(apiFetch(`/crm/activities?${qp.toString()}`));
    },
  },
  campaigns: {
    list: () => handle<unknown[]>(apiFetch("/campaigns")),
    get: (id: string) => handle<unknown>(apiFetch(`/campaigns/${id}`)),
    create: (body: unknown) =>
      handle<unknown>(
        apiFetch("/campaigns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      ),
    importCsv: (id: string, file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return handle<{
        created: number;
        skipped: number;
        skippedInvalidPhone?: number;
        skippedDuplicate?: number;
        skippedDnc?: number;
        duplicateExamples?: string[];
        invalidPhoneExamples?: string[];
        skippedRows?: { phone: string; reason: string }[];
      }>(apiFetch(`/campaigns/${id}/contacts`, { method: "POST", body: fd }));
    },
    delete: (id: string) =>
      handle<{ ok: boolean }>(apiFetch(`/campaigns/${id}`, { method: "DELETE" })),
    start: (id: string, opts?: { body?: string; smsPerMinute?: number }) =>
      handle<{
        ok: boolean;
        status: string;
        kind?: string;
        queued?: number;
        smsPerMinute?: number;
        spacingMs?: number;
        agentDialMode?: boolean;
      }>(
        apiFetch(`/campaigns/${id}/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(opts ?? {}),
        }),
      ),
    pause: (id: string) =>
      handle<unknown>(apiFetch(`/campaigns/${id}/pause`, { method: "POST" })),
    resume: (id: string, opts?: { body?: string; smsPerMinute?: number }) =>
      handle<{
        ok: boolean;
        status: string;
        kind?: string;
        queued?: number;
        smsTemplateUpdated?: boolean;
        agentDialMode?: boolean;
      }>(
        apiFetch(`/campaigns/${id}/resume`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(opts ?? {}),
        }),
      ),
    saveSmsTemplate: (id: string, body: string) =>
      handle<{ ok: boolean; id: string; smsTemplate: string | null; status: string }>(
        apiFetch(`/campaigns/${id}/sms-template`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body }),
        }),
      ),
    sms: (id: string, body: string, opts?: { contactIds?: string[]; smsPerMinute?: number }) =>
      handle<{ queued: number; smsPerMinute: number; spacingMs: number }>(
        apiFetch(`/campaigns/${id}/sms`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body,
            contactIds: opts?.contactIds,
            smsPerMinute: opts?.smsPerMinute,
          }),
        }),
      ),
    attempts: (id: string) =>
      handle<{ calls: unknown[]; sms: unknown[] }>(
        apiFetch(`/campaigns/${id}/attempts`),
      ),
    agentDisposition: (
      id: string,
      body: { contactId: string; disposition: "COMPLETED" | "NO_ANSWER" | "BUSY" | "FAILED" | "CANCELED" },
    ) =>
      handle<{
        ok: boolean;
        campaignStatus: string;
        nextContact: {
          id: string;
          phoneE164: string;
          name: string | null;
          zoomCallUrl: string;
        } | null;
      }>(
        apiFetch(`/campaigns/${encodeURIComponent(id)}/agent-disposition`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      ),
    agentSkip: (id: string, body: { contactId: string }) =>
      handle<{
        ok: boolean;
        campaignStatus: string;
        nextContact: {
          id: string;
          phoneE164: string;
          name: string | null;
          zoomCallUrl: string;
        } | null;
      }>(
        apiFetch(`/campaigns/${encodeURIComponent(id)}/agent-skip`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      ),
  },
  me: {
    preferences: {
      get: () =>
        handle<{ settings: UserWorkspaceSettings; updatedAt: string | null }>(apiFetch("/me/preferences")),
      patch: (body: { settings: Partial<UserWorkspaceSettings> }) =>
        handle<{ settings: UserWorkspaceSettings; updatedAt: string }>(
          apiFetch("/me/preferences", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
        ),
    },
    dashboard: () => handle<MeDashboardPayload>(apiFetch("/me/dashboard")),
    updateProfile: (body: { name: string }) =>
      handle<{ user: AuthSessionPayload["user"] }>(
        apiFetch("/me/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      ),
    changePassword: (body: { currentPassword: string; newPassword: string }) =>
      handle<{ ok: boolean }>(
        apiFetch("/me/password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      ),
  },
  dnc: {
    list: () => handle<unknown[]>(apiFetch("/dnc")),
    add: (e164: string) =>
      handle<unknown>(
        apiFetch("/dnc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ e164 }),
        }),
      ),
    remove: (e164: string) =>
      handle<unknown>(
        apiFetch(`/dnc/${encodeURIComponent(e164)}`, { method: "DELETE" }),
      ),
  },
};
