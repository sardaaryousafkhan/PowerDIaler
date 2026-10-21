import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import {
  coerceIntegrationProviderId,
  integrationsCatalog,
  SMS_PER_MINUTE_DEFAULT,
  SMS_PER_MINUTE_MAX,
  type IntegrationCapability,
  type IntegrationCatalogEntry,
  type IntegrationProviderId,
} from "@powerdialer/shared";
import { api } from "../api.js";
import { fetchIntegrationsWithRetries } from "../integrationFetch.js";
import { integrationLogoUrl, websiteHostFaviconUrl } from "../integrationLogos.js";
import { useNotifier } from "../notifications/context.js";

const LS_KEY = "pd_integration_pref_v1";

type SetupField = {
  key: string;
  label: string;
  kind: "text" | "password" | "url";
  required: boolean;
  hasValue: boolean;
  valueMask: string;
};

function readStoredPref(): string | null {
  try {
    return localStorage.getItem(LS_KEY);
  } catch {
    return null;
  }
}

function writeStoredPref(id: string): void {
  try {
    localStorage.setItem(LS_KEY, id);
  } catch {
    /* ignore */
  }
}

let integrationsOfflineToastShown = false;

function capabilityLabel(c: IntegrationCapability): string {
  switch (c) {
    case "voice":
      return "Voice";
    case "sms":
      return "SMS";
    case "messaging":
      return "Messaging";
    case "teams":
      return "Teams";
    case "crm":
      return "CRM";
    default:
      return c;
  }
}

function providerInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

function isCrmProvider(entry: IntegrationCatalogEntry): boolean {
  return entry.capabilities.includes("crm") && !entry.capabilities.includes("voice");
}

function setupHint(providerId: string): string {
  switch (providerId) {
    case "zoom_phone":
      return "Paste your Zoom App Marketplace Server-to-Server details (Account ID, Client ID, Client Secret), your Zoom Phone user ID, and outbound caller ID. DashDialer’s server helper talks to Zoom for you—you do not enter a bridge URL.";
    case "google_voice":
      return "When the Google Voice bridge is connected, DashDialer drives progressive dial. In hybrid mode, agents place calls via Google Voice on their machine.";
    case "twilio":
      return "Enter your Twilio Account SID and Auth Token from the Twilio console. These power live outbound calls and SMS.";
    case "vonage":
      return "Vonage needs: (1) API key + secret, (2) a Voice application ID + private key, and (3) a Vonage phone number you own. Use that Vonage number as the campaign sending number (e.g. +12025550101). Demo mode must be turned off for real calls.";
    case "whatsapp":
      return "WhatsApp Cloud API uses a Meta access token and phone number ID from your Business account.";
    default:
      return "Enter the connection details for this provider. Only fields you fill in will be updated.";
  }
}

function ProviderLogo(props: { id: IntegrationProviderId; name: string; websiteUrl: string; size?: "sm" | "md" }): ReactElement {
  const { id, name, websiteUrl, size = "md" } = props;
  const [phase, setPhase] = useState(0);
  const [src, setSrc] = useState(() => integrationLogoUrl(id, websiteUrl));
  const initials = providerInitials(name);
  const markClass =
    size === "sm"
      ? "integration-wizard__logo integration-wizard__logo--sm"
      : "integration-wizard__logo";

  useEffect(() => {
    setPhase(0);
    setSrc(integrationLogoUrl(id, websiteUrl));
  }, [id, websiteUrl]);

  return (
    <span className={phase < 2 ? `${markClass} integration-wizard__logo--img` : markClass}>
      {phase < 2 ? (
        <img
          className="integration-wizard__logo-img"
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => {
            if (phase === 0) {
              setSrc(websiteHostFaviconUrl(websiteUrl));
              setPhase(1);
            } else if (phase === 1) {
              setPhase(2);
            }
          }}
        />
      ) : (
        <span className="integration-wizard__logo-fallback" aria-hidden>
          {initials}
        </span>
      )}
    </span>
  );
}

export function IntegrationsPage(): ReactElement {
  const { pushToast, setActivity } = useNotifier();
  const [catalog, setCatalog] = useState<IntegrationCatalogEntry[] | null>(null);
  const [selected, setSelected] = useState<string>("twilio");
  const [savedKey, setSavedKey] = useState<string>("twilio");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reconnectBusy, setReconnectBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupFields, setSetupFields] = useState<SetupField[]>([]);
  const [setupValues, setSetupValues] = useState<Record<string, string>>({});
  const [setupConfigured, setSetupConfigured] = useState(false);
  const [setupRequiresSetup, setSetupRequiresSetup] = useState(true);
  const [setupMessage, setSetupMessage] = useState<string | null>(null);
  const [bridgeTestBusy, setBridgeTestBusy] = useState(false);
  const [bridgeTestResult, setBridgeTestResult] = useState<string | null>(null);
  const [smsPerMinute, setSmsPerMinute] = useState(SMS_PER_MINUTE_DEFAULT);
  const [smsRateBusy, setSmsRateBusy] = useState(false);

  const telephonyProviders = useMemo(
    () => (catalog ?? []).filter((e) => !isCrmProvider(e)),
    [catalog],
  );
  const crmProviders = useMemo(() => (catalog ?? []).filter((e) => isCrmProvider(e)), [catalog]);

  const selectedEntry = useMemo(
    () => catalog?.find((e) => e.id === selected) ?? null,
    [catalog, selected],
  );

  const loadSetup = useCallback(async (providerId: string) => {
    setSetupLoading(true);
    setBridgeTestResult(null);
    setSetupValues({});
    try {
      const res = await api.integrations.getProviderSetup(providerId);
      setSetupFields(res.fields);
      setSetupConfigured(res.configured);
      setSetupRequiresSetup(res.requiresSetup);
      setSetupMessage(res.help ?? res.message ?? null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSetupFields([]);
      setSetupConfigured(false);
      setSetupRequiresSetup(false);
      setSetupMessage(msg);
    } finally {
      setSetupLoading(false);
    }
  }, []);

  useEffect(() => {
    setActivity({
      headline: "Integrations",
      detail: "Choose a provider and enter connection details.",
      tone: "neutral",
    });
  }, [setActivity]);

  useEffect(() => {
    let alive = true;

    async function load(): Promise<void> {
      const result = await fetchIntegrationsWithRetries();
      if (!alive) return;
      if (result.ok) {
        const r = result.data;
        const key = coerceIntegrationProviderId(r.preference.preferredIntegrationKey);
        setCatalog(r.catalog as IntegrationCatalogEntry[]);
        setSelected(key);
        setSavedKey(key);
        setUpdatedAt(r.preference.updatedAt);
        if (typeof r.preference.smsPerMinute === "number") {
          setSmsPerMinute(Math.min(SMS_PER_MINUTE_MAX, Math.max(1, r.preference.smsPerMinute)));
        }
        setOffline(false);
        integrationsOfflineToastShown = false;
        writeStoredPref(key);
        return;
      }

      const key = coerceIntegrationProviderId(readStoredPref() ?? "twilio");
      setCatalog(integrationsCatalog);
      setSelected(key);
      setSavedKey(key);
      setUpdatedAt(null);
      setOffline(true);
      if (!integrationsOfflineToastShown) {
        integrationsOfflineToastShown = true;
        pushToast({
          variant: "warning",
          title: "Offline mode",
          message: result.error.message ?? "Preference is cached locally until connectivity is restored.",
          durationMs: 7000,
        });
      }
    }

    void load();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!catalog || offline) return;
    void loadSetup(selected);
  }, [selected, catalog, offline, loadSetup]);

  async function retryConnection(): Promise<void> {
    setReconnectBusy(true);
    try {
      const result = await fetchIntegrationsWithRetries();
      if (result.ok) {
        const r = result.data;
        const key = coerceIntegrationProviderId(r.preference.preferredIntegrationKey);
        setCatalog(r.catalog as IntegrationCatalogEntry[]);
        setSelected(key);
        setSavedKey(key);
        setUpdatedAt(r.preference.updatedAt);
        if (typeof r.preference.smsPerMinute === "number") {
          setSmsPerMinute(Math.min(SMS_PER_MINUTE_MAX, Math.max(1, r.preference.smsPerMinute)));
        }
        setOffline(false);
        integrationsOfflineToastShown = false;
        writeStoredPref(key);
        pushToast({
          variant: "success",
          title: "Connection restored",
          message: "Save again if you need to sync the server with your selection.",
        });
      } else {
        pushToast({
          variant: "warning",
          title: "Still unavailable",
          message: result.error.message || "The API did not respond; retry shortly.",
          durationMs: 6000,
        });
      }
    } finally {
      setReconnectBusy(false);
    }
  }

  async function saveSmsRate(): Promise<void> {
    const rate = Math.min(SMS_PER_MINUTE_MAX, Math.max(1, Math.floor(Number(smsPerMinute) || SMS_PER_MINUTE_DEFAULT)));
    setSmsRateBusy(true);
    try {
      if (offline) {
        pushToast({
          variant: "warning",
          title: "Offline",
          message: "Reconnect to save the SMS rate on the server.",
        });
        return;
      }
      const r = await api.integrations.setPreference({ smsPerMinute: rate });
      setSmsPerMinute(r.smsPerMinute);
      setUpdatedAt(r.updatedAt);
      pushToast({
        variant: "success",
        title: "SMS rate saved",
        message: `Broadcasts will queue at up to ${r.smsPerMinute} messages per minute.`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pushToast({ variant: "error", title: "Could not save SMS rate", message: msg });
    } finally {
      setSmsRateBusy(false);
    }
  }

  async function savePreference(): Promise<void> {
    setBusy(true);
    try {
      if (offline) {
        const key = coerceIntegrationProviderId(selected);
        writeStoredPref(key);
        setSavedKey(key);
        pushToast({
          variant: "success",
          title: "Saved locally",
          message: "When online, use Retry, then Save preference.",
        });
        return;
      }

      const r = await api.integrations.setPreference({ preferredIntegrationKey: selected });
      const key = coerceIntegrationProviderId(r.preferredIntegrationKey);
      setSavedKey(key);
      setSelected(key);
      setUpdatedAt(r.updatedAt);
      writeStoredPref(key);
      pushToast({
        variant: "success",
        title: "Preference saved",
        message: `New campaigns will route through ${catalog?.find((c) => c.id === key)?.name ?? key}.`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pushToast({ variant: "error", title: "Save failed", message: msg });
    } finally {
      setBusy(false);
    }
  }

  async function testBridgeConnection(): Promise<void> {
    setBridgeTestBusy(true);
    setBridgeTestResult(null);
    try {
      if (selected === "google_voice") {
        const res = await api.integrations.googleVoiceBridgeHealth();
        if (!res.ok) {
          setBridgeTestResult(`Bridge responded but not healthy (auth: ${res.googleAuth})`);
        } else if (res.mode === "mock") {
          setBridgeTestResult(
            "Connected in MOCK mode — calls/SMS are simulated. Set GOOGLE_VOICE_BRIDGE_MODE=hybrid or ccai in the bridge .env for real telephony.",
          );
        } else if (res.mode === "hybrid") {
          setBridgeTestResult(
            "Connected in HYBRID mode — outbound calls open tel:/Voice web on the agent machine; SMS is not available server-side.",
          );
        } else {
          setBridgeTestResult(
            `Connected — Google auth: ${res.googleAuth}, SMS: ${res.smsEnabled ? "enabled" : "off"}, mode: ${res.mode}`,
          );
        }
        return;
      }
      const res = await api.integrations.zoomBridgeHealth();
      if (!res.ok) {
        setBridgeTestResult(`Bridge responded but not healthy (auth: ${res.zoomAuth})`);
      } else if (res.mode === "agent_desktop" || res.agentDial) {
        setBridgeTestResult(
          res.message ??
            "Ready — Zoom Phone desktop mode. Keep Zoom signed in; use Call in Zoom on each contact (no autodial bridge).",
        );
      } else if (res.mode === "mock") {
        setBridgeTestResult(
          "Connected in MOCK mode — calls/SMS are simulated. Switch ZOOM_BRIDGE_MODE=api in the bridge .env for production.",
        );
      } else {
        setBridgeTestResult(
          `Connected — Zoom auth: ${res.zoomAuth}, SMS: ${res.smsEnabled ? "enabled" : "off"}, mode: ${res.mode}`,
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setBridgeTestResult(`Could not reach bridge: ${msg}`);
    } finally {
      setBridgeTestBusy(false);
    }
  }

  async function saveSetup(): Promise<void> {
    const hasInput = Object.values(setupValues).some((v) => v.trim().length > 0);
    if (!hasInput) {
      pushToast({
        variant: "warning",
        title: "Nothing to save",
        message: "Enter at least one setup value.",
      });
      return;
    }
    setSetupBusy(true);
    try {
      const result = await api.integrations.saveProviderSetup(selected, setupValues);
      setSetupConfigured(result.configured);
      setSetupFields(result.fields);
      setSetupValues({});
      pushToast({
        variant: "success",
        title: "Credentials saved",
        message: "Provider connection details were saved for this API instance.",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pushToast({ variant: "error", title: "Setup save failed", message: msg });
    } finally {
      setSetupBusy(false);
    }
  }

  const dirty = selected !== savedKey;
  const showBridgeTest = selected === "zoom_phone" || selected === "google_voice";
  const hint = setupHint(selected);

  if (!catalog) {
    return (
      <div className="panel panel-lift shimmer-panel">
        <div className="shimmer-line wide" />
        <div className="shimmer-line narrow" />
        <div className="shimmer-line wide" />
      </div>
    );
  }

  return (
    <div className="detail-stack integration-wizard">
      <p className="back-row">
        <Link className="text-link" to="/campaigns">
          ← Campaigns
        </Link>
      </p>

      <section className="panel panel-lift integration-wizard__hero">
        <p className="integration-wizard__eyebrow">Integrations</p>
        <h2 className="section-title integration-wizard__title">Connect your phone or CRM</h2>
        <p className="integration-wizard__lede">
          Pick a provider below, then fill in the connection details that appear. Save your preference so new
          campaigns route through the right system.
        </p>
        {offline ? (
          <p className="integration-offline-banner" role="status">
            Offline: choices are cached in this browser. When online, use <strong>Retry</strong>, then save
            again.
          </p>
        ) : null}
        {updatedAt ? (
          <p className="muted subtle integration-intro__meta">
            Last saved preference:{" "}
            <span className="mono fw-medium">{new Date(updatedAt).toLocaleString()}</span>
          </p>
        ) : null}
      </section>

      <section className="panel panel-lift" aria-labelledby="sms-rate-heading">
        <h3 id="sms-rate-heading" className="section-title">
          SMS send rate
        </h3>
        <p className="section-lede">
          How fast DashDialer queues outbound texts. You can set 1–{SMS_PER_MINUTE_MAX} messages per minute.
        </p>
        <label className="field" style={{ display: "block", marginTop: 12, maxWidth: 280 }}>
          <span className="field-label">Messages per minute</span>
          <input
            type="number"
            min={1}
            max={SMS_PER_MINUTE_MAX}
            step={1}
            value={smsPerMinute}
            disabled={smsRateBusy || offline}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (!Number.isFinite(next)) return;
              setSmsPerMinute(Math.min(SMS_PER_MINUTE_MAX, Math.max(1, Math.floor(next))));
            }}
          />
        </label>
        <div className="composer-actions" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="primary"
            disabled={smsRateBusy || offline}
            onClick={() => void saveSmsRate()}
          >
            {smsRateBusy ? "Saving…" : "Save SMS rate"}
          </button>
        </div>
      </section>

      <section className="panel panel-lift integration-wizard__panel" aria-labelledby="integration-step-1">
        <div className="integration-wizard__step-head">
          <span className="integration-wizard__step-badge">Step 1</span>
          <h3 id="integration-step-1" className="integration-wizard__step-title">
            Choose provider
          </h3>
        </div>

        <div className="integration-wizard__picker">
          <label className="integration-wizard__label" htmlFor="integration-provider-select">
            Provider
          </label>
          <div className="integration-wizard__select-wrap">
            <select
              id="integration-provider-select"
              className="integration-wizard__select"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {telephonyProviders.length ? (
                <optgroup label="Phone & messaging">
                  {telephonyProviders.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                      {entry.adapterStatus === "live" ? "" : " (planned)"}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {crmProviders.length ? (
                <optgroup label="CRM">
                  {crmProviders.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                      {entry.adapterStatus === "live" ? "" : " (planned)"}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </div>
        </div>

        {selectedEntry ? (
          <article className="integration-wizard__preview" aria-live="polite">
            <ProviderLogo
              key={selectedEntry.id}
              id={selectedEntry.id as IntegrationProviderId}
              name={selectedEntry.name}
              websiteUrl={selectedEntry.websiteUrl}
            />
            <div className="integration-wizard__preview-body">
              <div className="integration-wizard__preview-top">
                <h4 className="integration-wizard__preview-name">{selectedEntry.name}</h4>
                <span
                  className={
                    selectedEntry.adapterStatus === "live"
                      ? "integration-badge integration-badge--live"
                      : "integration-badge"
                  }
                >
                  {selectedEntry.adapterStatus === "live" ? "Available" : "Planned"}
                </span>
              </div>
              <p className="integration-wizard__preview-tagline">{selectedEntry.tagline}</p>
              <p className="integration-wizard__preview-category">{selectedEntry.category}</p>
              <div className="integration-wizard__preview-caps">
                {selectedEntry.capabilities.map((c) => (
                  <span key={c} className="integration-cap">
                    {capabilityLabel(c)}
                  </span>
                ))}
              </div>
              <a
                className="integration-wizard__vendor-link"
                href={selectedEntry.websiteUrl}
                target="_blank"
                rel="noreferrer noopener"
              >
                Visit vendor site ↗
              </a>
            </div>
          </article>
        ) : null}

        <div className="integration-wizard__pref-actions">
          {offline ? (
            <button
              type="button"
              className="ghost-btn glow-hover"
              disabled={reconnectBusy}
              aria-busy={reconnectBusy}
              onClick={() => void retryConnection()}
            >
              {reconnectBusy ? "Checking…" : "Retry connection"}
            </button>
          ) : null}
          <button
            type="button"
            className="primary glow-hover"
            disabled={!dirty || busy}
            onClick={() => void savePreference()}
          >
            {busy ? "Saving…" : dirty ? "Save as preferred provider" : "Preferred provider saved"}
          </button>
          {!dirty ? <span className="muted subtle">This provider is active for new campaigns.</span> : null}
        </div>
      </section>

      <section
        className="panel panel-lift integration-wizard__panel integration-wizard__panel--setup"
        aria-labelledby="integration-step-2"
      >
        <div className="integration-wizard__step-head">
          <span className="integration-wizard__step-badge">Step 2</span>
          <h3 id="integration-step-2" className="integration-wizard__step-title">
            Connection details
          </h3>
        </div>

        <p className="integration-wizard__hint">{setupMessage ?? hint}</p>

        {setupLoading ? (
          <div className="integration-wizard__loading" role="status">
            <span className="integration-wizard__loading-dot" aria-hidden />
            Loading fields for {selectedEntry?.name ?? "provider"}…
          </div>
        ) : null}

        {!setupLoading && !setupRequiresSetup && setupFields.length === 0 ? (
          <p className="integration-wizard__empty muted">
            {setupMessage ?? "No credential fields are required for this provider in the app yet."}
          </p>
        ) : null}

        {!setupLoading && setupFields.length > 0 ? (
          <div className="integration-wizard__fields">
            {setupFields.map((f) => (
              <div key={f.key} className="integration-wizard__field">
                <label htmlFor={`setup-${f.key}`}>
                  {f.label}
                  {f.required ? " *" : ""}
                </label>
                <input
                  id={`setup-${f.key}`}
                  type={f.kind === "password" ? "password" : "text"}
                  placeholder={f.hasValue ? `Saved — enter new value to replace (${f.valueMask})` : ""}
                  value={setupValues[f.key] ?? ""}
                  onChange={(e) =>
                    setSetupValues((prev) => ({
                      ...prev,
                      [f.key]: e.target.value,
                    }))
                  }
                  autoComplete="off"
                />
              </div>
            ))}
          </div>
        ) : null}

        {bridgeTestResult ? (
          <p className="integration-wizard__bridge-result" role="status">
            {bridgeTestResult}
          </p>
        ) : null}

        <div className="integration-wizard__setup-actions">
          {showBridgeTest ? (
            <button
              type="button"
              className="ghost-btn glow-hover"
              disabled={bridgeTestBusy || setupLoading}
              onClick={() => void testBridgeConnection()}
            >
              {bridgeTestBusy
                ? "Testing…"
                : selected === "zoom_phone"
                  ? "Test connection"
                  : "Test bridge connection"}
            </button>
          ) : null}
          {setupFields.length > 0 ? (
            <button
              type="button"
              className="primary glow-hover"
              disabled={setupBusy || setupLoading}
              onClick={() => void saveSetup()}
            >
              {setupBusy ? "Saving credentials…" : "Save credentials"}
            </button>
          ) : null}
          <span
            className={
              setupConfigured
                ? "integration-wizard__status integration-wizard__status--ok"
                : "integration-wizard__status"
            }
          >
            {setupConfigured ? "Credentials on file" : "Not configured yet"}
          </span>
        </div>
      </section>
    </div>
  );
}
