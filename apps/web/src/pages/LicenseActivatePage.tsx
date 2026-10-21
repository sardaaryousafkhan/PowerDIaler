import { useState, type FormEvent, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { useLicense } from "../licenseContext.js";

export function LicenseActivatePage(): ReactElement {
  const { status, activate, refresh, isDesktop, blocksPaid } = useLicense();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await activate(key.trim());
      if (res.ok) setMsg("License active. You can run campaigns and texts.");
      else setMsg(res.error || "License not active.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!isDesktop) {
    return (
      <div className="layout padded">
        <div className="panel panel-lift" style={{ maxWidth: 560 }}>
          <h2 className="section-title">License</h2>
          <p className="muted">Licensing applies in the DashDialer desktop app. Browser demo mode stays unlocked for development.</p>
          <Link className="text-link" to="/dashboard">Back to dashboard</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="layout padded">
      <div className="panel panel-lift" style={{ maxWidth: 560 }}>
        <h2 className="section-title">Activate DashDialer</h2>
        <p className="section-lede">
          Paste the license key from derivedstudio.com. If you stop paying, the seller revokes the key and paid features lock on the next check.
        </p>
        <p className="muted subtle">
          Status: <strong>{status?.status || (blocksPaid ? "inactive" : "active")}</strong>
          {status?.machineId ? <> · Device {status.machineId.slice(0, 8)}…</> : null}
        </p>
        <form className="form-grid" onSubmit={onSubmit} style={{ marginTop: 16 }}>
          <label className="field">
            <span className="field-label">License key</span>
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="DD-XXXX-XXXX-XXXX-XXXX"
              autoComplete="off"
              required
            />
          </label>
          <div className="row gap">
            <button className="primary" type="submit" disabled={busy}>
              {busy ? "Checking…" : "Activate"}
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={() => void refresh()}>
              Refresh status
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => window.dashdialerDesktop?.openExternal("https://derivedstudio.com/dashdialer/")}
            >
              Get a license
            </button>
          </div>
        </form>
        {msg ? <p className={blocksPaid && !status?.ok ? "error" : "muted"} style={{ marginTop: 12 }}>{msg}</p> : null}
        {!blocksPaid ? (
          <p style={{ marginTop: 16 }}>
            <Link className="text-link" to="/dashboard">Continue to dashboard</Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}
