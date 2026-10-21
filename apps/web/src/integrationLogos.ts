import type { IntegrationProviderId } from "@powerdialer/shared";

/** High-res favicons (colored) from vendor marketing domains — works in light and dark UI. */
const BRAND_LOGO_DOMAIN: Partial<Record<IntegrationProviderId, string>> = {
  twilio: "twilio.com",
  vonage: "vonage.com",
  ringcentral: "ringcentral.com",
  google_voice: "google.com",
  nextiva: "nextiva.com",
  dialpad: "dialpad.com",
  zoom_phone: "zoom.us",
  aircall: "aircall.io",
  "8x8": "8x8.com",
  ooma_office: "ooma.com",
  callhippo: "callhippo.com",
  whatsapp: "whatsapp.com",
  microsoft_teams_phone: "microsoft.com",
  salesforce: "salesforce.com",
  zoho: "zoho.com",
  hubspot: "hubspot.com",
  pipedrive: "pipedrive.com",
  freshsales: "freshworks.com",
  zendesk_sell: "zendesk.com",
};

function googleFavicon(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
}

/** Favicon for the marketing site hostname (fallback when mapped logo fails). */
export function websiteHostFaviconUrl(websiteUrl: string): string {
  try {
    const host = new URL(websiteUrl).hostname.replace(/^www\./, "");
    return googleFavicon(host);
  } catch {
    return googleFavicon("twilio.com");
  }
}

/**
 * Logo image URL for an integration row. Prefers a stable brand domain mapping so
 * subpaths (e.g. Zoom Phone) still resolve to a recognizable icon.
 */
export function integrationLogoUrl(id: IntegrationProviderId, websiteUrl: string): string {
  const mapped = BRAND_LOGO_DOMAIN[id];
  if (mapped) return googleFavicon(mapped);
  return websiteHostFaviconUrl(websiteUrl);
}
