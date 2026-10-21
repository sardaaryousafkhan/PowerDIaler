import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { api, type UserWorkspaceSettings } from "../api.js";
import { useAuth } from "../authContext.js";
import { useNotifier } from "../notifications/context.js";
import { useUserPreferences } from "../userPreferencesContext.js";

function roleLabel(role: string | undefined): string {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  return "User";
}

export function UserPortalPage(): ReactElement {
  const { user, refreshSession } = useAuth();
  const { pushToast } = useNotifier();
  const { settings, loading: prefsLoading, updateSettings } = useUserPreferences();

  const [name, setName] = useState(user?.name ?? "");
  const [savingName, setSavingName] = useState(false);
  const [nameMsg, setNameMsg] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<string | null>(null);

  const [prefsMsg, setPrefsMsg] = useState<string | null>(null);
  const [savingPrefs, setSavingPrefs] = useState(false);

  useEffect(() => {
    setName(user?.name ?? "");
  }, [user?.name]);

  async function onSaveName(e: FormEvent): Promise<void> {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setNameMsg("Name must be at least 2 characters.");
      return;
    }
    setSavingName(true);
    setNameMsg(null);
    try {
      await api.me.updateProfile({ name: trimmed });
      await refreshSession();
      setNameMsg("Name saved.");
      pushToast({ variant: "success", title: "Profile updated" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not save name.";
      setNameMsg(msg);
      pushToast({ variant: "error", title: "Profile save failed", message: msg });
    } finally {
      setSavingName(false);
    }
  }

  async function onChangePassword(e: FormEvent): Promise<void> {
    e.preventDefault();
    setPasswordMsg(null);
    if (newPassword.length < 8) {
      setPasswordMsg("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMsg("New password and confirmation do not match.");
      return;
    }
    setSavingPassword(true);
    try {
      await api.me.changePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMsg("Password updated.");
      pushToast({ variant: "success", title: "Password changed" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not change password.";
      setPasswordMsg(msg);
      pushToast({ variant: "error", title: "Password change failed", message: msg });
    } finally {
      setSavingPassword(false);
    }
  }

  async function patchPrefs(partial: Partial<UserWorkspaceSettings>): Promise<void> {
    setSavingPrefs(true);
    setPrefsMsg(null);
    try {
      await updateSettings(partial);
      setPrefsMsg("Preferences saved.");
    } catch (err: unknown) {
      setPrefsMsg(err instanceof Error ? err.message : "Could not save preferences.");
    } finally {
      setSavingPrefs(false);
    }
  }

  return (
    <div className="detail-stack">
      <header className="page-hero">
        <h2 className="page-hero__title">User portal</h2>
        <p className="page-hero__lede">Your profile, password, and personal workspace preferences.</p>
      </header>

      <section className="panel panel-lift">
        <h3 className="section-title">Account</h3>
        <dl className="profile-dl">
          <div>
            <dt>Email</dt>
            <dd className="mono">{user?.email ?? "—"}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>{roleLabel(user?.role)}</dd>
          </div>
        </dl>
      </section>

      <section className="panel panel-lift">
        <h3 className="section-title">Display name</h3>
        <form className="settings-form" onSubmit={(e) => void onSaveName(e)}>
          <label htmlFor="portal-name">Name</label>
          <input
            id="portal-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            disabled={savingName}
            maxLength={80}
          />
          {nameMsg ? (
            <p className={`settings-banner${nameMsg === "Name saved." ? " settings-banner--ok" : " settings-banner--err"}`}>
              {nameMsg}
            </p>
          ) : null}
          <button className="primary" type="submit" disabled={savingName || name.trim() === (user?.name ?? "")}>
            {savingName ? "Saving…" : "Save name"}
          </button>
        </form>
      </section>

      <section className="panel panel-lift">
        <h3 className="section-title">Change password</h3>
        <form className="settings-form" onSubmit={(e) => void onChangePassword(e)}>
          <label htmlFor="portal-current-pw">Current password</label>
          <input
            id="portal-current-pw"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            disabled={savingPassword}
            required
          />
          <label htmlFor="portal-new-pw">New password</label>
          <input
            id="portal-new-pw"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            disabled={savingPassword}
            minLength={8}
            required
          />
          <label htmlFor="portal-confirm-pw">Confirm new password</label>
          <input
            id="portal-confirm-pw"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            disabled={savingPassword}
            minLength={8}
            required
          />
          {passwordMsg ? (
            <p
              className={`settings-banner${
                passwordMsg === "Password updated." ? " settings-banner--ok" : " settings-banner--err"
              }`}
            >
              {passwordMsg}
            </p>
          ) : null}
          <button className="primary" type="submit" disabled={savingPassword}>
            {savingPassword ? "Updating…" : "Update password"}
          </button>
        </form>
      </section>

      <section className="panel panel-lift">
        <h3 className="section-title">Personal preferences</h3>
        <p className="section-lede">
          Dashboard welcome and activity detail. Theme lives in the command bar (top right). Full settings also at{" "}
          <Link className="text-link" to="/dashboard/settings">
            Workspace settings
          </Link>
          .
        </p>
        {prefsLoading && !settings ? (
          <div className="shimmer-panel" aria-busy="true">
            <div className="shimmer-line wide" />
            <div className="shimmer-line narrow" />
          </div>
        ) : (
          <form className="settings-form" onSubmit={(e: FormEvent) => e.preventDefault()}>
            <label className="checkbox-row" htmlFor="portal-welcome">
              <input
                id="portal-welcome"
                type="checkbox"
                checked={settings?.showDashboardWelcome !== false}
                disabled={savingPrefs}
                onChange={(e) => void patchPrefs({ showDashboardWelcome: e.target.checked })}
              />
              <span>Show personalized welcome on the dashboard</span>
            </label>
            <label htmlFor="portal-log">Log detail level</label>
            <select
              id="portal-log"
              className="settings-select"
              value={settings?.logDetailLevel ?? "normal"}
              disabled={savingPrefs}
              onChange={(e) =>
                void patchPrefs({ logDetailLevel: e.target.value as UserWorkspaceSettings["logDetailLevel"] })
              }
            >
              <option value="summary">Summary (times, types, titles)</option>
              <option value="normal">Normal (adds trimmed details)</option>
              <option value="verbose">Verbose (full detail strings)</option>
            </select>
            {prefsMsg ? (
              <p
                className={`settings-banner${
                  prefsMsg === "Preferences saved." ? " settings-banner--ok" : " settings-banner--err"
                }`}
              >
                {prefsMsg}
              </p>
            ) : null}
            <p className="muted subtle">{savingPrefs ? "Saving…" : " "}</p>
          </form>
        )}
      </section>
    </div>
  );
}
