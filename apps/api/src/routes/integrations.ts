import type { FastifyInstance } from "fastify";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  coerceIntegrationProviderId,
  integrationProviderIdSchema,
  integrationPreferencePatchSchema,
  integrationsCatalog,
  SMS_PER_MINUTE_DEFAULT,
} from "@powerdialer/shared";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { enforceFunctionAccess } from "../functionAccess.js";
import { fetchGoogleVoiceBridgeHealth } from "../lib/bridgeHealth.js";

const setupPatchSchema = z.object({
  values: z.record(z.string(), z.string()),
});

function envFilePath(): string {
  return fileURLToPath(new URL("../../.env", import.meta.url));
}

/** Quote/escape so multi-line secrets (Vonage PEM keys) survive a .env file. */
function encodeEnvValue(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function upsertEnvValue(rawEnv: string, key: string, value: string): string {
  const line = `${key}=${encodeEnvValue(value)}`;
  // Drop any previous assignment for this key (single-line only; we always write
  // quoted single-line values so multi-line PEMs cannot corrupt the file).
  const lines = rawEnv.split(/\r?\n/).filter((l) => !l.startsWith(`${key}=`));
  const trimmed = lines.join("\n").trimEnd();
  return trimmed.length ? `${trimmed}\n${line}\n` : `${line}\n`;
}

function maskTail(raw: string): string {
  if (!raw) return "";
  if (raw.length <= 6) return "*".repeat(raw.length);
  return `${"*".repeat(raw.length - 4)}${raw.slice(-4)}`;
}

type SetupFieldDef = {
  key: string;
  label: string;
  kind: "text" | "password" | "url";
  /** Process env key and/or OrganizationSecret key. */
  envKey: keyof typeof env;
  required: boolean;
  secret?: boolean;
  /**
   * When true, values are stored only as per-org encrypted secrets (not written to
   * the shared apps/api/.env). Used for multi-tenant Zoom Marketplace credentials.
   */
  orgOnly?: boolean;
};

function bridgeSetupFields(args: {
  label: string;
  baseUrlKey: keyof typeof env;
  apiKeyKey: keyof typeof env;
  keyPrefix: string;
}): SetupFieldDef[] {
  return [
    {
      key: `${args.keyPrefix}BridgeBaseUrl`,
      label: `${args.label} bridge URL`,
      kind: "url",
      envKey: args.baseUrlKey,
      required: true,
    },
    {
      key: `${args.keyPrefix}BridgeApiKey`,
      label: `${args.label} bridge API key`,
      kind: "password",
      envKey: args.apiKeyKey,
      required: false,
      secret: true,
    },
  ];
}

function setupFieldsForProvider(provider: string): SetupFieldDef[] {
  switch (provider) {
    case "twilio":
      return [
        {
          key: "twilioAccountSid",
          label: "Twilio account SID",
          kind: "text",
          envKey: "TWILIO_ACCOUNT_SID",
          required: true,
        },
        {
          key: "twilioAuthToken",
          label: "Twilio auth token",
          kind: "password",
          envKey: "TWILIO_AUTH_TOKEN",
          required: true,
          secret: true,
        },
      ];
    case "whatsapp":
      return [
        {
          key: "whatsappAccessToken",
          label: "WhatsApp access token",
          kind: "password",
          envKey: "WHATSAPP_ACCESS_TOKEN",
          required: true,
          secret: true,
        },
        {
          key: "whatsappPhoneNumberId",
          label: "WhatsApp phone number id",
          kind: "text",
          envKey: "WHATSAPP_PHONE_NUMBER_ID",
          required: true,
        },
      ];
    case "vonage":
      return [
        {
          key: "vonageApiKey",
          label: "Vonage API key",
          kind: "text",
          envKey: "VONAGE_API_KEY",
          required: true,
        },
        {
          key: "vonageApiSecret",
          label: "Vonage API secret",
          kind: "password",
          envKey: "VONAGE_API_SECRET",
          required: true,
          secret: true,
        },
        {
          key: "vonageApplicationId",
          label: "Vonage application ID",
          kind: "text",
          envKey: "VONAGE_APPLICATION_ID",
          required: true,
        },
        {
          key: "vonagePrivateKey",
          label: "Vonage private key (PEM)",
          kind: "password",
          envKey: "VONAGE_PRIVATE_KEY",
          required: true,
          secret: true,
        },
        {
          key: "vonageBrandName",
          label: "Vonage SMS brand name",
          kind: "text",
          envKey: "VONAGE_BRAND_NAME",
          required: false,
        },
        {
          key: "vonageWebhookSignatureSecret",
          label: "Vonage webhook signature secret",
          kind: "password",
          envKey: "VONAGE_WEBHOOK_SIGNATURE_SECRET",
          required: false,
          secret: true,
        },
      ];
    case "google_voice":
      return [
        ...bridgeSetupFields({
          label: "Google Voice",
          baseUrlKey: "GOOGLE_VOICE_BRIDGE_BASE_URL",
          apiKeyKey: "GOOGLE_VOICE_BRIDGE_API_KEY",
          keyPrefix: "googleVoice",
        }),
        {
          key: "bridgeCallbackSecret",
          label: "Bridge callback secret (must match bridge service)",
          kind: "password",
          envKey: "BRIDGE_CALLBACK_SECRET",
          required: false,
          secret: true,
        },
      ];
    case "callhippo":
      return bridgeSetupFields({
        label: "CallHippo",
        baseUrlKey: "CALLHIPPO_BRIDGE_BASE_URL",
        apiKeyKey: "CALLHIPPO_BRIDGE_API_KEY",
        keyPrefix: "callHippo",
      });
    case "ringcentral":
      return bridgeSetupFields({
        label: "RingCentral",
        baseUrlKey: "RINGCENTRAL_BRIDGE_BASE_URL",
        apiKeyKey: "RINGCENTRAL_BRIDGE_API_KEY",
        keyPrefix: "ringCentral",
      });
    case "nextiva":
      return bridgeSetupFields({
        label: "Nextiva",
        baseUrlKey: "NEXTIVA_BRIDGE_BASE_URL",
        apiKeyKey: "NEXTIVA_BRIDGE_API_KEY",
        keyPrefix: "nextiva",
      });
    case "dialpad":
      return bridgeSetupFields({
        label: "Dialpad",
        baseUrlKey: "DIALPAD_BRIDGE_BASE_URL",
        apiKeyKey: "DIALPAD_BRIDGE_API_KEY",
        keyPrefix: "dialpad",
      });
    case "zoom_phone":
      // Customer pastes Marketplace Server-to-Server details only.
      // Bridge URL/API key stay in platform server env (hidden from this form).
      return [
        {
          key: "zoomAccountId",
          label: "Zoom Account ID",
          kind: "text",
          envKey: "ZOOM_ACCOUNT_ID",
          required: true,
          orgOnly: true,
        },
        {
          key: "zoomClientId",
          label: "Zoom Client ID",
          kind: "text",
          envKey: "ZOOM_CLIENT_ID",
          required: true,
          orgOnly: true,
        },
        {
          key: "zoomClientSecret",
          label: "Zoom Client Secret",
          kind: "password",
          envKey: "ZOOM_CLIENT_SECRET",
          required: true,
          secret: true,
          orgOnly: true,
        },
        {
          key: "zoomDefaultUserId",
          label: "Default Zoom Phone user ID",
          kind: "text",
          envKey: "ZOOM_DEFAULT_USER_ID",
          required: true,
          orgOnly: true,
        },
        {
          key: "zoomPhoneCallerId",
          label: "Outbound caller ID (E.164, e.g. +19163065045)",
          kind: "text",
          envKey: "ZOOM_PHONE_CALLER_ID",
          required: true,
          orgOnly: true,
        },
      ];
    case "aircall":
      return bridgeSetupFields({
        label: "Aircall",
        baseUrlKey: "AIRCALL_BRIDGE_BASE_URL",
        apiKeyKey: "AIRCALL_BRIDGE_API_KEY",
        keyPrefix: "aircall",
      });
    case "8x8":
      return bridgeSetupFields({
        label: "8x8",
        baseUrlKey: "EIGHT_BY_EIGHT_BRIDGE_BASE_URL",
        apiKeyKey: "EIGHT_BY_EIGHT_BRIDGE_API_KEY",
        keyPrefix: "eightByEight",
      });
    case "ooma_office":
      return bridgeSetupFields({
        label: "Ooma Office",
        baseUrlKey: "OOMA_OFFICE_BRIDGE_BASE_URL",
        apiKeyKey: "OOMA_OFFICE_BRIDGE_API_KEY",
        keyPrefix: "oomaOffice",
      });
    case "microsoft_teams_phone":
      return bridgeSetupFields({
        label: "Microsoft Teams Phone",
        baseUrlKey: "MICROSOFT_TEAMS_PHONE_BRIDGE_BASE_URL",
        apiKeyKey: "MICROSOFT_TEAMS_PHONE_BRIDGE_API_KEY",
        keyPrefix: "microsoftTeamsPhone",
      });
    case "custom_integration":
      return bridgeSetupFields({
        label: "Custom integration",
        baseUrlKey: "CUSTOM_INTEGRATION_BRIDGE_BASE_URL",
        apiKeyKey: "CUSTOM_INTEGRATION_BRIDGE_API_KEY",
        keyPrefix: "customIntegration",
      });
    case "salesforce":
      return bridgeSetupFields({
        label: "Salesforce CRM",
        baseUrlKey: "SALESFORCE_CRM_BRIDGE_BASE_URL",
        apiKeyKey: "SALESFORCE_CRM_BRIDGE_API_KEY",
        keyPrefix: "salesforceCrm",
      });
    case "zoho":
      return bridgeSetupFields({
        label: "Zoho CRM",
        baseUrlKey: "ZOHO_CRM_BRIDGE_BASE_URL",
        apiKeyKey: "ZOHO_CRM_BRIDGE_API_KEY",
        keyPrefix: "zohoCrm",
      });
    case "hubspot":
      return bridgeSetupFields({
        label: "HubSpot CRM",
        baseUrlKey: "HUBSPOT_CRM_BRIDGE_BASE_URL",
        apiKeyKey: "HUBSPOT_CRM_BRIDGE_API_KEY",
        keyPrefix: "hubspotCrm",
      });
    case "pipedrive":
      return bridgeSetupFields({
        label: "Pipedrive CRM",
        baseUrlKey: "PIPEDRIVE_CRM_BRIDGE_BASE_URL",
        apiKeyKey: "PIPEDRIVE_CRM_BRIDGE_API_KEY",
        keyPrefix: "pipedriveCrm",
      });
    case "freshsales":
      return bridgeSetupFields({
        label: "Freshsales CRM",
        baseUrlKey: "FRESHSALES_CRM_BRIDGE_BASE_URL",
        apiKeyKey: "FRESHSALES_CRM_BRIDGE_API_KEY",
        keyPrefix: "freshsalesCrm",
      });
    case "zendesk_sell":
      return bridgeSetupFields({
        label: "Zendesk Sell CRM",
        baseUrlKey: "ZENDESK_SELL_CRM_BRIDGE_BASE_URL",
        apiKeyKey: "ZENDESK_SELL_CRM_BRIDGE_API_KEY",
        keyPrefix: "zendeskSellCrm",
      });
    default:
      return [];
  }
}

function isConfiguredFromValues(fields: SetupFieldDef[], values: Record<string, string>): boolean {
  if (!fields.length) return false;
  return fields.every((f) => {
    if (!f.required) return true;
    return (values[String(f.envKey)] ?? "").trim().length > 0;
  });
}

export async function integrationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/integrations", async (req, reply) => {
    const { isRbacEnforceAdminPerms } = await import("../rbac/enforceFlag.js");
    const { requireOrg } = await import("../lib/orgAccess.js");
    const { requirePermissionBatch1 } = await import("../rbac/permissionGate.js");
    const { getOrgIntegrationPreference } = await import("../lib/orgPreferences.js");
    // Flag off: preserve requireOrg (any member). Flag on: Owner-only integrations_manage.
    const auth = isRbacEnforceAdminPerms()
      ? await requirePermissionBatch1(req, reply, "integrations_manage", "GET /integrations")
      : await requireOrg(req, reply);
    if (!auth) return;
    let preference = await getOrgIntegrationPreference(auth.orgId);

    const normalized = coerceIntegrationProviderId(preference.preferredIntegrationKey);
    if (normalized !== preference.preferredIntegrationKey) {
      preference = await prisma.integrationPreference.update({
        where: { id: preference.id },
        data: { preferredIntegrationKey: normalized },
      });
    }

    return {
      catalog: integrationsCatalog,
      preference: {
        preferredIntegrationKey: preference.preferredIntegrationKey,
        smsPerMinute: preference.smsPerMinute,
        updatedAt: preference.updatedAt.toISOString(),
      },
    };
  });

  app.put("/integrations/preference", async (req, reply) => {
    if (!(await enforceFunctionAccess(req as { auth: { sub: string; role: "user" | "admin" | "owner" } | null }, reply, "integrations_manage"))) {
      return;
    }
    const { requireOrg, writeAuditLog } = await import("../lib/orgAccess.js");
    const auth = await requireOrg(req, reply);
    if (!auth) return;
    const body = integrationPreferencePatchSchema.parse(req.body);
    const existing = await prisma.integrationPreference.findUnique({
      where: { organizationId: auth.orgId },
    });
    const preferredIntegrationKey =
      body.preferredIntegrationKey ??
      existing?.preferredIntegrationKey ??
      "twilio";
    const smsPerMinute = body.smsPerMinute ?? existing?.smsPerMinute ?? SMS_PER_MINUTE_DEFAULT;
    const preference = await prisma.integrationPreference.upsert({
      where: { organizationId: auth.orgId },
      create: {
        organizationId: auth.orgId,
        preferredIntegrationKey,
        smsPerMinute,
      },
      update: {
        ...(body.preferredIntegrationKey !== undefined
          ? { preferredIntegrationKey: body.preferredIntegrationKey }
          : {}),
        ...(body.smsPerMinute !== undefined ? { smsPerMinute: body.smsPerMinute } : {}),
      },
    });
    await writeAuditLog({
      organizationId: auth.orgId,
      actorUserId: auth.sub,
      action: "integrations.preference_updated",
      entityType: "IntegrationPreference",
      entityId: preference.id,
    });
    return reply.send({
      preferredIntegrationKey: preference.preferredIntegrationKey,
      smsPerMinute: preference.smsPerMinute,
      updatedAt: preference.updatedAt.toISOString(),
    });
  });

  app.get("/integrations/setup/:provider", async (req, reply) => {
    const { isRbacEnforceAdminPerms } = await import("../rbac/enforceFlag.js");
    const { requireOrg } = await import("../lib/orgAccess.js");
    const { requirePermissionBatch1 } = await import("../rbac/permissionGate.js");
    const { getOrgSecret } = await import("../lib/secrets.js");
    // E05: flag off → requireOrg; flag on → integrations_manage (Owner-only).
    const auth = isRbacEnforceAdminPerms()
      ? await requirePermissionBatch1(req, reply, "integrations_manage", "GET /integrations/setup/:provider")
      : await requireOrg(req, reply);
    if (!auth) return;
    const provider = integrationProviderIdSchema.parse((req.params as { provider?: string }).provider);
    const fields = setupFieldsForProvider(provider);
    if (!fields.length) {
      return {
        provider,
        requiresSetup: false,
        configured: false,
        fields: [],
        message: "No local credential fields are defined for this provider yet.",
      };
    }
    const valueByEnvKey: Record<string, string> = {};
    for (const f of fields) {
      const key = String(f.envKey);
      if (f.orgOnly) {
        valueByEnvKey[key] = (await getOrgSecret(auth.orgId, key)) ?? "";
      } else {
        const fromOrg = await getOrgSecret(auth.orgId, key);
        valueByEnvKey[key] = fromOrg?.trim() || (env[f.envKey] ?? "").toString();
      }
    }
    return {
      provider,
      requiresSetup: true,
      configured: isConfiguredFromValues(fields, valueByEnvKey),
      help:
        provider === "zoom_phone"
          ? "Create a Server-to-Server OAuth app in the Zoom App Marketplace, add Phone scopes, activate the app, then paste Account ID, Client ID, Client Secret, your Zoom Phone user ID, and outbound caller ID here."
          : undefined,
      fields: fields.map((f) => {
        const raw = valueByEnvKey[String(f.envKey)] ?? "";
        return {
          key: f.key,
          label: f.label,
          kind: f.kind,
          required: f.required,
          hasValue: raw.trim().length > 0,
          valueMask: raw ? (f.secret ? maskTail(raw) : raw) : "",
        };
      }),
    };
  });

  app.get("/integrations/google_voice/bridge-health", async (req, reply) => {
    const { isRbacEnforceAdminPerms } = await import("../rbac/enforceFlag.js");
    const { requireOrg } = await import("../lib/orgAccess.js");
    const { requirePermissionBatch1 } = await import("../rbac/permissionGate.js");
    // E06: flag off → any authenticated org member; flag on → integrations_manage.
    const auth = isRbacEnforceAdminPerms()
      ? await requirePermissionBatch1(
          req,
          reply,
          "integrations_manage",
          "GET /integrations/google_voice/bridge-health",
        )
      : await requireOrg(req, reply);
    if (!auth) return;
    const health = await fetchGoogleVoiceBridgeHealth();
    if (!health) {
      return reply.code(503).send({
        ok: false,
        error: "Bridge unreachable or not configured",
      });
    }
    return {
      ok: health.ok,
      googleAuth: health.googleAuth ?? "unknown",
      googleVoiceReady: health.googleVoiceReady ?? true,
      smsEnabled: health.smsEnabled ?? false,
      mode: health.mode,
    };
  });

  app.get("/integrations/zoom_phone/bridge-health", async (req, reply) => {
    const { isRbacEnforceAdminPerms } = await import("../rbac/enforceFlag.js");
    const { requireOrg } = await import("../lib/orgAccess.js");
    const { requirePermissionBatch1 } = await import("../rbac/permissionGate.js");
    const { readPreferredIntegrationKey } = await import("../lib/zoomPhoneAgent.js");
    const { fetchZoomBridgeHealthForOrg } = await import("../lib/bridgeHealth.js");
    const { loadZoomOrgCredentials } = await import("../lib/zoomOrgCredentials.js");
    const { env: runtimeEnv } = await import("../env.js");
    // E06: flag off → requireOrg; flag on → integrations_manage.
    const auth = isRbacEnforceAdminPerms()
      ? await requirePermissionBatch1(
          req,
          reply,
          "integrations_manage",
          "GET /integrations/zoom_phone/bridge-health",
        )
      : await requireOrg(req, reply);
    if (!auth) return;
    const preferred = await readPreferredIntegrationKey(auth.orgId);
    const creds = await loadZoomOrgCredentials(auth.orgId);
    const health = await fetchZoomBridgeHealthForOrg(creds);
    const bridgeUp = Boolean(health?.ok && (health.zoomAuth === "ok" || health.mode === "mock"));
    const agentDial =
      preferred === "zoom_phone" &&
      ((runtimeEnv.DEMO_MODE && !runtimeEnv.DEMO_USE_BRIDGE) || !bridgeUp);
    if (!health) {
      if (agentDial) {
        return {
          ok: true,
          zoomAuth: "desktop",
          zoomUserPhoneLicense: true,
          smsEnabled: false,
          mode: "agent_desktop",
          agentDial: true,
          message:
            "Zoom Phone desktop mode is ready. Keep the Zoom app signed in; campaigns use Call in Zoom (no server-side dial).",
        };
      }
      if (!creds) {
        return reply.code(400).send({
          ok: false,
          error:
            "Save your Zoom Account ID, Client ID, Client Secret, Phone user ID, and caller ID first.",
          agentDial: false,
        });
      }
      return reply.code(503).send({
        ok: false,
        error: "Zoom helper unreachable or not configured on the server",
        agentDial: false,
      });
    }
    return {
      ok: health.ok && health.zoomAuth === "ok",
      zoomAuth: health.zoomAuth,
      zoomUserPhoneLicense: health.zoomUserPhoneLicense ?? true,
      smsEnabled: health.smsEnabled ?? false,
      mode: health.mode,
      agentDial: false,
    };
  });

  app.put("/integrations/setup/:provider", async (req, reply) => {
    if (!(await enforceFunctionAccess(req as { auth: { sub: string; role: "user" | "admin" | "owner" } | null }, reply, "integrations_manage"))) {
      return;
    }
    const { requireOrg, writeAuditLog } = await import("../lib/orgAccess.js");
    const { setOrgSecret } = await import("../lib/secrets.js");
    const auth = await requireOrg(req, reply);
    if (!auth) return;
    const provider = integrationProviderIdSchema.parse((req.params as { provider?: string }).provider);
    const fields = setupFieldsForProvider(provider);
    if (!fields.length) {
      return reply.code(400).send({ error: "No setup fields are defined for this provider" });
    }
    const body = setupPatchSchema.parse(req.body);
    const provided = body.values ?? {};
    const hasAnyProvided = fields.some((f) => (provided[f.key] ?? "").trim().length > 0);
    if (!hasAnyProvided) {
      return reply.code(400).send({ error: "Provide at least one setup value" });
    }

    let content = "";
    try {
      content = await fs.readFile(envFilePath(), "utf8");
    } catch {
      content = "";
    }

    const { getOrgSecret } = await import("../lib/secrets.js");
    const storedKeys: string[] = [];
    let wroteEnv = false;
    for (const f of fields) {
      const nextRaw = (provided[f.key] ?? "").trim();
      if (!nextRaw) continue;
      await setOrgSecret(auth.orgId, String(f.envKey), nextRaw);
      storedKeys.push(String(f.envKey));
      if (!f.orgOnly) {
        env[f.envKey] = nextRaw as never;
        content = upsertEnvValue(content, String(f.envKey), nextRaw);
        wroteEnv = true;
      }
    }
    if (wroteEnv) {
      await fs.writeFile(envFilePath(), content, "utf8");
    }
    await writeAuditLog({
      organizationId: auth.orgId,
      actorUserId: auth.sub,
      action: "integrations.secret_updated",
      entityType: "OrganizationSecret",
      meta: { provider, keys: storedKeys },
    });

    const valueByEnvKey: Record<string, string> = {};
    for (const f of fields) {
      const key = String(f.envKey);
      if (f.orgOnly) {
        valueByEnvKey[key] = (await getOrgSecret(auth.orgId, key)) ?? "";
      } else {
        const fromOrg = await getOrgSecret(auth.orgId, key);
        valueByEnvKey[key] = fromOrg?.trim() || (env[f.envKey] ?? "").toString();
      }
    }

    return reply.send({
      ok: true,
      provider,
      configured: isConfiguredFromValues(fields, valueByEnvKey),
      fields: fields.map((f) => {
        const raw = valueByEnvKey[String(f.envKey)] ?? "";
        return {
          key: f.key,
          label: f.label,
          kind: f.kind,
          required: f.required,
          hasValue: raw.trim().length > 0,
          valueMask: raw ? (f.secret ? maskTail(raw) : raw) : "",
        };
      }),
    });
  });
}
