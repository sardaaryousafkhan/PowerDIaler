import {
  getIntegrationCatalogEntry,
  type IntegrationProviderId,
} from "@powerdialer/shared";
import { env } from "../env.js";

type CrmProviderId =
  | "salesforce"
  | "zoho"
  | "hubspot"
  | "pipedrive"
  | "freshsales"
  | "zendesk_sell"
  | "custom_integration";

type CrmBridgeConfig = {
  baseUrl: string;
  apiKey?: string;
};

type CrmBridgeResult<T> = {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
};

function cleanBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, "");
}

function crmBridgeConfig(provider: CrmProviderId): CrmBridgeConfig | null {
  switch (provider) {
    case "salesforce":
      return env.SALESFORCE_CRM_BRIDGE_BASE_URL
        ? {
            baseUrl: env.SALESFORCE_CRM_BRIDGE_BASE_URL,
            apiKey: env.SALESFORCE_CRM_BRIDGE_API_KEY,
          }
        : null;
    case "zoho":
      return env.ZOHO_CRM_BRIDGE_BASE_URL
        ? {
            baseUrl: env.ZOHO_CRM_BRIDGE_BASE_URL,
            apiKey: env.ZOHO_CRM_BRIDGE_API_KEY,
          }
        : null;
    case "hubspot":
      return env.HUBSPOT_CRM_BRIDGE_BASE_URL
        ? {
            baseUrl: env.HUBSPOT_CRM_BRIDGE_BASE_URL,
            apiKey: env.HUBSPOT_CRM_BRIDGE_API_KEY,
          }
        : null;
    case "pipedrive":
      return env.PIPEDRIVE_CRM_BRIDGE_BASE_URL
        ? {
            baseUrl: env.PIPEDRIVE_CRM_BRIDGE_BASE_URL,
            apiKey: env.PIPEDRIVE_CRM_BRIDGE_API_KEY,
          }
        : null;
    case "freshsales":
      return env.FRESHSALES_CRM_BRIDGE_BASE_URL
        ? {
            baseUrl: env.FRESHSALES_CRM_BRIDGE_BASE_URL,
            apiKey: env.FRESHSALES_CRM_BRIDGE_API_KEY,
          }
        : null;
    case "zendesk_sell":
      return env.ZENDESK_SELL_CRM_BRIDGE_BASE_URL
        ? {
            baseUrl: env.ZENDESK_SELL_CRM_BRIDGE_BASE_URL,
            apiKey: env.ZENDESK_SELL_CRM_BRIDGE_API_KEY,
          }
        : null;
    case "custom_integration":
      return env.CUSTOM_INTEGRATION_CRM_BRIDGE_BASE_URL
        ? {
            baseUrl: env.CUSTOM_INTEGRATION_CRM_BRIDGE_BASE_URL,
            apiKey: env.CUSTOM_INTEGRATION_CRM_BRIDGE_API_KEY,
          }
        : env.CUSTOM_INTEGRATION_BRIDGE_BASE_URL
          ? {
              baseUrl: env.CUSTOM_INTEGRATION_BRIDGE_BASE_URL,
              apiKey: env.CUSTOM_INTEGRATION_BRIDGE_API_KEY,
            }
          : null;
    default:
      return null;
  }
}

export function assertCrmProvider(provider: IntegrationProviderId): CrmProviderId {
  const entry = getIntegrationCatalogEntry(provider);
  if (!entry.capabilities.includes("crm")) {
    throw new Error(`Provider "${provider}" is not CRM-capable`);
  }
  return provider as CrmProviderId;
}

export function isCrmBridgeConfigured(provider: IntegrationProviderId): boolean {
  const crmProvider = assertCrmProvider(provider);
  return Boolean(crmBridgeConfig(crmProvider));
}

export async function callCrmBridge<T>(
  provider: IntegrationProviderId,
  path: string,
  payload: Record<string, unknown>,
): Promise<CrmBridgeResult<T>> {
  const crmProvider = assertCrmProvider(provider);
  const cfg = crmBridgeConfig(crmProvider);
  if (!cfg) {
    return {
      ok: false,
      status: 400,
      error: `CRM bridge is not configured for provider "${provider}"`,
    };
  }
  const endpoint = `${cleanBaseUrl(cfg.baseUrl)}${path}`;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cfg.apiKey
          ? { authorization: `Bearer ${cfg.apiKey}`, "x-api-key": cfg.apiKey }
          : {}),
      },
      signal: AbortSignal.timeout(12_000),
      body: JSON.stringify({
        provider,
        ...payload,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: data.error ?? `CRM bridge request failed (${res.status})`,
      };
    }
    return { ok: true, status: res.status, data };
  } catch (error) {
    return {
      ok: false,
      status: 502,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
