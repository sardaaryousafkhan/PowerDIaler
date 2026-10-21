import { useEffect, useState, type ReactElement } from "react";
import { api, type OrgBillingPayload } from "../api.js";
import { useAuth } from "../authContext.js";

export function OrgBillingPage(): ReactElement {
  const { can } = useAuth();
  const [data, setData] = useState<OrgBillingPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void api.org
      .billing()
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  if (!can("billing_view")) {
    return <div className="layout padded error">You do not have access to billing.</div>;
  }

  return (
    <div className="layout padded">
      <h1>Billing</h1>
      {err ? <p className="error">{err}</p> : null}
      {!data ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="panel panel-lift" style={{ maxWidth: 560 }}>
          <p>
            <strong>Plan:</strong> {data.subscription?.plan.name ?? "Starter"}
          </p>
          <p>
            <strong>Status:</strong> {data.subscription?.status ?? "trialing"}
          </p>
          <p>
            <strong>Seats:</strong> {data.seatsUsed} / {data.seatLimit}
          </p>
          <p>
            <strong>SMS monthly cap:</strong> {data.subscription?.plan.smsMonthlyCap ?? "—"}
          </p>
          <p className="muted" style={{ marginTop: 16 }}>
            Manual billing — contact sales@derivedstudio.com. Plan limits above are enforced in this
            workspace.
          </p>
        </div>
      )}
    </div>
  );
}
