import { useEffect, useMemo, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

type CrmProviderStatus = {
  provider: string;
  configured: boolean;
  mode: "bridge" | "built_in";
};

type CrmActivity = {
  id: string;
  provider: string;
  type: "call" | "sms" | "note";
  status: string | null;
  summary: string;
  createdAt: string;
};

export function CrmPage(): ReactElement {
  const [providers, setProviders] = useState<string[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>("all");
  const [statuses, setStatuses] = useState<Record<string, CrmProviderStatus>>({});
  const [activities, setActivities] = useState<CrmActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const crmProviders = useMemo(() => providers, [providers]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const integrations = await api.integrations.get();
        const crmOnly = integrations.catalog
          .filter((entry) => entry.capabilities.includes("crm"))
          .map((entry) => entry.id);

        if (!mounted) return;
        setProviders(crmOnly);

        const fetchedStatuses = await Promise.all(
          crmOnly.map(async (provider) => {
            const status = await api.crm.providerStatus(provider);
            return [provider, status] as const;
          }),
        );
        if (!mounted) return;
        setStatuses(Object.fromEntries(fetchedStatuses));

        const list = await api.crm.activities(undefined, 100);
        if (!mounted) return;
        setActivities(list.items);
      } catch (e) {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const visibleActivities =
    selectedProvider === "all"
      ? activities
      : activities.filter((activity) => activity.provider === selectedProvider);

  return (
    <div className="detail-stack">
      <p className="back-row">
        <Link className="text-link" to="/dashboard">
          ← Dashboard
        </Link>
      </p>

      <section className="panel panel-lift">
        <h2 className="section-title">CRM connectors</h2>
        <p className="muted">
          This page shows which customer management connectors are available and how activity logging is running.
        </p>
        {loading ? <p className="muted">Loading CRM status…</p> : null}
        {error ? <p className="error">{error}</p> : null}
      </section>

      {!loading && !error ? (
        <>
          <section className="panel panel-lift">
            <h3 className="section-title" style={{ marginTop: 0 }}>
              Provider status
            </h3>
            <div className="detail-stack">
              {crmProviders.length === 0 ? (
                <p className="muted">No CRM providers found in the integration catalog.</p>
              ) : (
                crmProviders.map((provider) => {
                  const status = statuses[provider];
                  return (
                    <div key={provider} className="row" style={{ alignItems: "center" }}>
                      <div>
                        <p className="fw-medium" style={{ margin: 0 }}>
                          {provider}
                        </p>
                        <p className="muted subtle" style={{ margin: 0 }}>
                          Mode: {status?.mode === "bridge" ? "Bridge service" : "Built in"}
                        </p>
                      </div>
                      <span className={`integration-badge ${status?.configured ? "integration-badge--live" : ""}`}>
                        {status?.configured ? "Configured" : "Not configured"}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <section className="panel panel-lift">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <h3 className="section-title" style={{ margin: 0 }}>
                CRM activity log
              </h3>
              <select value={selectedProvider} onChange={(e) => setSelectedProvider(e.target.value)}>
                <option value="all">All providers</option>
                {crmProviders.map((provider) => (
                  <option key={provider} value={provider}>
                    {provider}
                  </option>
                ))}
              </select>
            </div>
            <div className="detail-stack" style={{ marginTop: 12 }}>
              {visibleActivities.length === 0 ? (
                <p className="muted">No CRM activity found yet.</p>
              ) : (
                visibleActivities.map((activity) => (
                  <article key={activity.id} className="panel">
                    <p style={{ margin: 0 }}>
                      <strong>{activity.provider}</strong> · {activity.type.toUpperCase()}
                      {activity.status ? ` · ${activity.status}` : ""}
                    </p>
                    <p className="muted" style={{ margin: "6px 0" }}>
                      {activity.summary}
                    </p>
                    <p className="muted subtle" style={{ margin: 0 }}>
                      {new Date(activity.createdAt).toLocaleString()}
                    </p>
                  </article>
                ))
              )}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
