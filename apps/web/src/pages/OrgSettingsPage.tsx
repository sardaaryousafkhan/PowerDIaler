import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { SMS_PER_MINUTE_MAX } from "@powerdialer/shared";
import { api } from "../api.js";
import { useAuth } from "../authContext.js";
import { useNotifier } from "../notifications/context.js";

export function OrgSettingsPage(): ReactElement {
  const { can } = useAuth();
  const { pushToast } = useNotifier();
  const [name, setName] = useState("");
  const [smsPerMinute, setSmsPerMinute] = useState(30);
  const [timezone, setTimezone] = useState("UTC");
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<Array<Record<string, unknown>>>([]);

  useEffect(() => {
    void api.org.settings().then((s) => {
      setName(s.name);
      setSmsPerMinute(s.smsPerMinute);
      setTimezone(String(s.settings.timezone ?? "UTC"));
    });
    if (can("members_manage")) {
      void api.org.auditLogs().then((r) => setLogs(r.logs.slice(0, 30)));
    }
  }, [can]);

  if (!can("company_settings")) {
    return <div className="layout padded error">You do not have access to company settings.</div>;
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.org.patchSettings({
        name,
        smsPerMinute,
        settings: { timezone },
      });
      pushToast({ variant: "success", title: "Saved", message: "Organization settings updated." });
    } catch (err) {
      pushToast({
        variant: "error",
        title: "Save failed",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="org-settings-editorial page-enter">
      <header className="org-settings-editorial__section">
        <h1 className="editorial editorial--hero" style={{ fontSize: 40, lineHeight: "44px", margin: 0 }}>
          Organization
        </h1>
        <p className="muted" style={{ margin: 0, maxWidth: "42ch" }}>
          Company identity, pace limits, and team access — one scroll, no card maze.
        </p>
      </header>

      <section className="org-settings-editorial__section" aria-labelledby="org-identity">
        <h2 id="org-identity" className="editorial">
          Identity & pace
        </h2>
        <form onSubmit={onSave}>
          <label>Company name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
          <label>Timezone</label>
          <input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
          <label>SMS / min (max {SMS_PER_MINUTE_MAX})</label>
          <input
            type="number"
            min={1}
            max={SMS_PER_MINUTE_MAX}
            value={smsPerMinute}
            onChange={(e) => setSmsPerMinute(Number(e.target.value))}
          />
          <button className="primary" type="submit" disabled={busy} style={{ marginTop: 8, alignSelf: "flex-start" }}>
            Save settings
          </button>
        </form>
      </section>

      {can("members_manage") ? (
        <section className="org-settings-editorial__section" aria-labelledby="org-team">
          <h2 id="org-team" className="editorial">
            Team
          </h2>
          <p className="muted" style={{ margin: 0 }}>
            Add employees, set roles, and assign campaigns from the Members page.
          </p>
          <Link className="primary button" to="/portal/admin" style={{ display: "inline-block", alignSelf: "flex-start" }}>
            Manage members
          </Link>
        </section>
      ) : null}

      {logs.length ? (
        <section className="org-settings-editorial__section" aria-labelledby="org-history">
          <h2 id="org-history" className="editorial">
            Activity history
          </h2>
          <p className="muted subtle" style={{ margin: 0 }}>
            {logs.length} recent events
          </p>
          <ul className="audit-list">
            {logs.map((l) => (
              <li key={String(l.id)}>
                <span className="mono muted subtle">{new Date(String(l.createdAt)).toLocaleString()}</span>
                <span className="pill pill-soft">{String(l.action).replace(/[._]/g, " ")}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
