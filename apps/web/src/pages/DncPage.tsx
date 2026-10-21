import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { formatShortDateTime } from "../format.js";
import { useNotifier } from "../notifications/context.js";

type Row = { id: string; e164: string; createdAt: string };

export function DncPage(): ReactElement {
  const { pushToast } = useNotifier();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [e164, setE164] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const r = (await api.dnc.list()) as Row[];
    setRows(r);
  }, []);

  useEffect(() => {
    reload().catch((e: Error) => {
      setErr(e.message);
      pushToast({ variant: "error", title: "Unable to load DNC list", message: e.message });
    });
  }, [reload, pushToast]);

  async function add() {
    setErr(null);
    try {
      await api.dnc.add(e164.trim());
      pushToast({
        variant: "success",
        title: "Number added",
        message: "Outbound skips this E.164 on import and SMS sends.",
      });
      setE164("");
      await reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      pushToast({ variant: "error", title: "Add failed", message: msg });
    }
  }

  async function remove(phone: string) {
    setErr(null);
    try {
      await api.dnc.remove(phone);
      pushToast({ variant: "info", title: "Removed", message: phone });
      await reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      pushToast({ variant: "error", title: "Remove failed", message: msg });
    }
  }

  if (!rows)
    return (
      <div className="detail-stack">
        <header className="page-hero">
          <h2 className="page-hero__title">Do not call</h2>
          <p className="page-hero__lede">Loading…</p>
        </header>
        <div className="panel shimmer-panel">
          <div className="shimmer-line wide" />
          <div className="shimmer-line narrow" />
        </div>
      </div>
    );

  return (
    <div className="detail-stack">
      <header className="page-hero">
        <h2 className="page-hero__title">Do not call</h2>
        <p className="page-hero__lede">
          These E.164 values are suppressed on CSV import and SMS queueing. Dial attempts respect the same list.
        </p>
      </header>

      <div className="panel panel-lift">
        <div className="row">
          <div>
            <label htmlFor="dnc-e164">Phone number</label>
            <input
              id="dnc-e164"
              value={e164}
              onChange={(ev) => setE164(ev.target.value)}
              placeholder="+15551234567"
              autoComplete="tel"
            />
          </div>
          <div style={{ display: "flex", alignItems: "end" }}>
            <button className="primary glow-hover" type="button" onClick={() => void add()}>
              Add
            </button>
          </div>
        </div>
        {err ? <p className="error">{err}</p> : null}
      </div>

      <div className="panel panel-lift">
          <h3 className="section-title" style={{ marginTop: 0 }}>
          Entries ({rows.length})
        </h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Number</th>
                <th scope="col">Added</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="table-row-enter">
                  <td className="mono">{r.e164}</td>
                  <td>
                    <span className="muted subtle">{formatShortDateTime(r.createdAt)}</span>
                  </td>
                  <td>
                    <button className="danger soft-hover" type="button" onClick={() => void remove(r.e164)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 ? (
          <p className="muted subtle" style={{ marginBottom: 0 }}>
            No DNC entries yet.{" "}
            <Link className="text-link" to="/campaigns">
              Campaigns
            </Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}
