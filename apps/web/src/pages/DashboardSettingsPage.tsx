import { useState, type FormEvent, type ReactElement } from "react";
import { Link } from "react-router-dom";
import type { UserWorkspaceSettings } from "../api.js";
import { useUserPreferences } from "../userPreferencesContext.js";

export function DashboardSettingsPage(): ReactElement {
  const { settings, loading, updateSettings } = useUserPreferences();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const current = settings;

  async function patch(partial: Partial<UserWorkspaceSettings>): Promise<void> {
    setSaving(true);
    setMessage(null);
    try {
      await updateSettings(partial);
      setMessage("Saved.");
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings-shell">
      <header className="settings-shell__header">
        <div>
          <p className="settings-shell__eyebrow">Personalization</p>
          <h1 className="settings-shell__title">Workspace settings</h1>
          <p className="muted subtle">
            These settings are saved to your account and follow you on every device. Open the{" "}
            <Link className="text-link" to="/dashboard">
              dashboard
            </Link>{" "}
            for live stats and logs.
          </p>
        </div>
        <Link className="ghost-btn" to="/dashboard">
          Back to dashboard
        </Link>
      </header>

      <section className="panel panel-lift settings-panel">
        {loading && !current ? (
          <div className="shimmer-panel" aria-busy="true">
            <div className="shimmer-line wide" />
            <div className="shimmer-line wide" />
            <div className="shimmer-line narrow" />
          </div>
        ) : null}

        {message ? (
          <p className={`settings-banner${message === "Saved." ? " settings-banner--ok" : " settings-banner--err"}`}>
            {message}
          </p>
        ) : null}

        <form className="settings-form" onSubmit={(e: FormEvent) => e.preventDefault()}>
          <h2 className="section-title">Dashboard</h2>
          <p className="section-lede">Control the welcome hero and how much detail shows in the activity table.</p>

          <label className="checkbox-row" htmlFor="set-welcome">
            <input
              id="set-welcome"
              type="checkbox"
              checked={current?.showDashboardWelcome !== false}
              disabled={saving}
              onChange={(e) => void patch({ showDashboardWelcome: e.target.checked })}
            />
            <span>Show personalized welcome on the dashboard</span>
          </label>

          <label htmlFor="set-log">Log detail level</label>
          <select
            id="set-log"
            className="settings-select"
            value={current?.logDetailLevel ?? "normal"}
            disabled={saving}
            onChange={(e) =>
              void patch({ logDetailLevel: e.target.value as UserWorkspaceSettings["logDetailLevel"] })
            }
          >
            <option value="summary">Summary (times, types, titles)</option>
            <option value="normal">Normal (adds trimmed details)</option>
            <option value="verbose">Verbose (full detail strings)</option>
          </select>
          <p className="field-hint">Used by the dashboard activity table.</p>
        </form>

        <p className="muted subtle settings-foot">{saving ? "Saving…" : " "}</p>
      </section>
    </div>
  );
}
