import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from "react";
import { Link } from "react-router-dom";
import type { MeDashboardPayload } from "../api.js";
import { api } from "../api.js";
import { useAuth } from "../authContext.js";
import { AppLogoMark } from "../components/AppLogo.js";
import { CountUp } from "../components/CountUp.js";
import { PaceRing } from "../components/PaceRing.js";
import { useUserPreferences } from "../userPreferencesContext.js";

type RangePreset = "today" | "7d" | "30d" | "custom";

function formatShortDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function campaignStatusBadgeClass(status: string): string {
  const s = status.toUpperCase();
  if (s === "RUNNING") return "badge badge-running";
  if (s === "PAUSED") return "badge badge-paused";
  if (s === "COMPLETED") return "badge badge-completed";
  return "badge badge-draft";
}
const DASHBOARD_SUPPORT_KEY = "pd_me_dashboard_supported";

function isRouteMissingError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("route get:/me/dashboard not found");
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function rangeBounds(
  preset: RangePreset,
  customFrom: string,
  customTo: string,
): { start: Date; end: Date } {
  const now = new Date();
  if (preset === "today") return { start: startOfDay(now), end: endOfDay(now) };
  if (preset === "7d") {
    const start = startOfDay(now);
    start.setDate(start.getDate() - 6);
    return { start, end: endOfDay(now) };
  }
  if (preset === "30d") {
    const start = startOfDay(now);
    start.setDate(start.getDate() - 29);
    return { start, end: endOfDay(now) };
  }
  const start = customFrom ? startOfDay(new Date(customFrom + "T00:00:00")) : new Date(0);
  const end = customTo ? endOfDay(new Date(customTo + "T00:00:00")) : endOfDay(now);
  return { start, end };
}

function inRange(iso: string, start: Date, end: Date): boolean {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return t >= start.getTime() && t <= end.getTime();
}

function csvEscape(value: string | number): string {
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(filename: string, rows: string[][]): void {
  const body = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toFallbackDashboard(
  me: { user: { id: string; name: string; email: string; role: "user" | "admin" | "owner" } },
  campaignsRaw: unknown[],
): MeDashboardPayload {
  const campaigns: MeDashboardPayload["campaigns"] = campaignsRaw
    .map((row) => row as Record<string, unknown>)
    .filter((row) => typeof row.id === "string" && typeof row.name === "string")
    .map((row) => ({
      id: String(row.id),
      name: String(row.name),
      kind: String(row.kind ?? "DIAL"),
      status: String(row.status ?? "DRAFT"),
      updatedAt: String(row.updatedAt ?? new Date().toISOString()),
      _count: {
        contacts: Number((row._count as { contacts?: unknown } | undefined)?.contacts ?? 0),
        callAttempts: Number((row._count as { callAttempts?: unknown } | undefined)?.callAttempts ?? 0),
        smsAttempts: Number((row._count as { smsAttempts?: unknown } | undefined)?.smsAttempts ?? 0),
      },
    }));

  const contactsTotal = campaigns.reduce((sum, c) => sum + c._count.contacts, 0);
  const campaignsRunning = campaigns.filter((c) => c.status.toUpperCase() === "RUNNING").length;

  return {
    user: {
      id: me.user.id,
      name: me.user.name,
      email: me.user.email,
      role: me.user.role,
      memberSince: new Date().toISOString(),
    },
    settings: {
      theme: "system",
      showDashboardWelcome: true,
      logDetailLevel: "normal",
    },
    summary: {
      campaignsTotal: campaigns.length,
      campaignsRunning,
      contactsTotal,
      callsTotal: 0,
      smsTotal: 0,
    },
    callsByDisposition: {},
    smsByStatus: {},
    campaigns,
    activity: [],
    webhookEvents: [],
  };
}

function BarRow({ label, value, max }: { label: string; value: number; max: number }): ReactElement {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="dash-bar-row">
      <div className="dash-bar-row__meta">
        <span className="dash-bar-row__label">{label}</span>
        <span className="dash-bar-row__value">{value}</span>
      </div>
      <div className="dash-bar-row__track" role="presentation">
        <div className="dash-bar-row__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function DashboardPage(): ReactElement {
  const { user } = useAuth();
  const { settings } = useUserPreferences();
  const [data, setData] = useState<MeDashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [degraded, setDegraded] = useState(false);
  const [rangePreset, setRangePreset] = useState<RangePreset>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    setDegraded(false);
    let supportKnownMissing = false;
    try {
      supportKnownMissing = sessionStorage.getItem(DASHBOARD_SUPPORT_KEY) === "0";
    } catch {
      supportKnownMissing = false;
    }
    if (supportKnownMissing) {
      void Promise.all([api.auth.me(), api.campaigns.list()])
        .then(([me, campaigns]) => {
          setData(toFallbackDashboard(me, campaigns));
          setDegraded(true);
          setError(null);
        })
        .catch((e: unknown) => {
          const message = e instanceof Error ? e.message : "Could not load dashboard.";
          setData(null);
          setError(message);
        })
        .finally(() => {
          setLoading(false);
        });
      return;
    }
    void api.me
      .dashboard()
      .then((r) => {
        try {
          sessionStorage.setItem(DASHBOARD_SUPPORT_KEY, "1");
        } catch {
          // ignore storage issues
        }
        setData(r);
        setError(null);
      })
      .catch(async (e: unknown) => {
        const message = e instanceof Error ? e.message : "Could not load dashboard.";
        if (isRouteMissingError(message)) {
          try {
            sessionStorage.setItem(DASHBOARD_SUPPORT_KEY, "0");
          } catch {
            // ignore storage issues
          }
          try {
            const [me, campaigns] = await Promise.all([api.auth.me(), api.campaigns.list()]);
            setData(toFallbackDashboard(me, campaigns));
            setDegraded(true);
            setError(null);
            return;
          } catch {
            // fall through to full error
          }
        }
        setData(null);
        setError(message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    void load();
  }, [load, user?.id]);

  const bounds = useMemo(
    () => rangeBounds(rangePreset, customFrom, customTo),
    [rangePreset, customFrom, customTo],
  );

  const filteredCampaigns = useMemo(() => {
    if (!data) return [];
    return data.campaigns.filter((c) => inRange(c.updatedAt, bounds.start, bounds.end));
  }, [data, bounds]);

  const filteredActivity = useMemo(() => {
    if (!data) return [];
    return data.activity.filter((row) => inRange(row.at, bounds.start, bounds.end));
  }, [data, bounds]);

  const filteredWebhooks = useMemo(() => {
    if (!data) return [];
    return data.webhookEvents.filter((w) => inRange(w.at, bounds.start, bounds.end));
  }, [data, bounds]);

  /** Recompute KPIs from filtered campaigns when disposition/status charts lack dates */
  const filteredSummary = useMemo(() => {
    const campaignsTotal = filteredCampaigns.length;
    const campaignsRunning = filteredCampaigns.filter((c) => c.status.toUpperCase() === "RUNNING").length;
    const contactsTotal = filteredCampaigns.reduce((sum, c) => sum + c._count.contacts, 0);
    const callsTotal = filteredCampaigns.reduce((sum, c) => sum + c._count.callAttempts, 0);
    const smsTotal = filteredCampaigns.reduce((sum, c) => sum + c._count.smsAttempts, 0);
    return { campaignsTotal, campaignsRunning, contactsTotal, callsTotal, smsTotal };
  }, [filteredCampaigns]);

  const displayName = data?.user.name ?? user?.name ?? "there";

  const callMax = useMemo(() => {
    if (!data) return 1;
    const vals = Object.values(data.callsByDisposition);
    if (!vals.length) return 1;
    return Math.max(1, ...vals);
  }, [data]);

  const smsMax = useMemo(() => {
    if (!data) return 1;
    const vals = Object.values(data.smsByStatus);
    if (!vals.length) return 1;
    return Math.max(1, ...vals);
  }, [data]);

  const callRows = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.callsByDisposition).sort((a, b) => b[1] - a[1]);
  }, [data]);

  const smsRows = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.smsByStatus)
      .map(([k, v]) => [k === "SKIPPED" ? "Skipped — already texted" : k, v] as [string, number])
      .sort((a, b) => b[1] - a[1]);
  }, [data]);

  const detailLevel = settings?.logDetailLevel ?? "normal";
  const activityCols = detailLevel === "summary" ? 4 : 5;

  const showHero = settings?.showDashboardWelcome !== false;
  const chartsDisabled = Boolean(error) && !data;
  const connectsInRange = filteredSummary.callsTotal;
  const paceMax = Math.max(20, Math.ceil((connectsInRange || 1) * 1.25));
  const ctaRef = useRef<HTMLAnchorElement>(null);

  function onCtaMove(e: ReactMouseEvent<HTMLAnchorElement>): void {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--cta-x", `${((e.clientX - r.left) / r.width) * 100}%`);
    el.style.setProperty("--cta-y", `${((e.clientY - r.top) / r.height) * 100}%`);
  }

  function onExport(): void {
    const rows: string[][] = [
      ["Section", "Name", "Kind", "Status", "Contacts", "Calls", "SMS", "Updated / When", "Detail"],
    ];
    for (const c of filteredCampaigns) {
      rows.push([
        "campaign",
        c.name,
        c.kind,
        c.status,
        String(c._count.contacts),
        String(c._count.callAttempts),
        String(c._count.smsAttempts),
        c.updatedAt,
        "",
      ]);
    }
    for (const row of filteredActivity) {
      rows.push([
        "activity",
        row.label,
        row.kind,
        "",
        "",
        "",
        "",
        row.at,
        row.detail,
      ]);
    }
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`powerdialer-dashboard-${stamp}.csv`, rows);
  }

  const rangePresets: Array<{ id: RangePreset; label: string }> = [
    { id: "today", label: "Today" },
    { id: "7d", label: "Last 7 days" },
    { id: "30d", label: "Last 30 days" },
    { id: "custom", label: "Custom" },
  ];

  return (
    <div className="detail-stack dash-page page-enter hero-glow">
      <div className="app-logo-watermark" aria-hidden>
        <AppLogoMark size={320} />
      </div>
      {error ? (
        <div className="dash-alert dash-alert--error" role="alert">
          <div className="dash-alert__body">
            <strong>Dashboard could not load.</strong>
            <span>{error}</span>
            <span className="muted subtle dash-alert__hint">
              If the API was started before the personalized dashboard was added, restart it so{" "}
              <code className="mono">/me/dashboard</code> is available.
            </span>
          </div>
          <button type="button" className="ghost-btn" onClick={() => void load()} disabled={loading}>
            {loading ? "Retrying…" : "Retry"}
          </button>
        </div>
      ) : null}
      {degraded ? (
        <div className="dash-alert" role="status">
          <div className="dash-alert__body">
            <strong>Using compatibility mode.</strong>
            <span>
              Core dashboard is available from standard routes. Restart the API service to enable full activity, call/SMS
              statistics, and webhook insights.
            </span>
          </div>
        </div>
      ) : null}

      <div className="dash-hero-bleed">
        <section className="dash-pace" aria-label="Connects in range">
          <div className="dash-pace__ring-wrap">
            <PaceRing value={connectsInRange} max={paceMax} />
          </div>
          <div className="dash-pace__stat">
            <span className="dash-pace__label">Connects in range</span>
            {loading && !data ? (
              <span className="dash-pace__value">—</span>
            ) : (
              <CountUp className="dash-pace__value" value={connectsInRange} />
            )}
            <p className="muted subtle" style={{ margin: 0, maxWidth: "36ch" }}>
              Call attempts from campaigns updated in the selected date range. The ring tracks pace against that load.
            </p>
          </div>
        </section>

        {showHero ? (
          <section className="dash-hero">
            <div className="dash-hero__top">
              <div>
                <p className="dash-hero__eyebrow">Your workspace</p>
                <h1 className="dash-hero__title">
                  Hello, <span className="dash-hero__name">{displayName}</span>
                </h1>
                <p className="dash-hero__lede">
                  Pace, outcomes, and recent campaigns. Tweak welcome and activity detail in{" "}
                  <Link className="text-link" to="/dashboard/settings">
                    Workspace settings
                  </Link>
                  .
                </p>
              </div>
              <div className="dash-hero__actions">
                <Link className="ghost-btn" to="/dashboard/settings">
                  Settings
                </Link>
                <Link
                  ref={ctaRef}
                  className="dashboard-action dashboard-action--primary cta-glow pressable"
                  to="/new"
                  onMouseMove={onCtaMove}
                >
                  Start dialing
                </Link>
              </div>
            </div>
          </section>
        ) : (
          <section className="dash-hero">
            <div className="dash-hero__top">
              <div>
                <h1 className="dash-hero__title">Dashboard</h1>
                <p className="muted subtle">Welcome card is turned off in Workspace settings.</p>
              </div>
              <Link className="ghost-btn" to="/dashboard/settings">
                Settings
              </Link>
            </div>
          </section>
        )}

        <div className="dash-kpi-fold">
          <div className="dash-range-bar" role="toolbar" aria-label="Date range">
            <div className="dash-range-bar__presets">
              {rangePresets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`filter-chip${rangePreset === p.id ? " filter-chip--on" : ""}`}
                  onClick={() => setRangePreset(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {rangePreset === "custom" ? (
              <div className="dash-range-bar__custom">
                <label className="muted subtle">
                  From{" "}
                  <input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                  />
                </label>
                <label className="muted subtle">
                  To{" "}
                  <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
                </label>
              </div>
            ) : null}
            <button
              type="button"
              className="ghost-btn dash-range-bar__export"
              onClick={onExport}
              disabled={!data || filteredCampaigns.length + filteredActivity.length === 0}
            >
              Export CSV
            </button>
          </div>

          <section className="dash-kpi-row" aria-label="Key metrics" aria-busy={loading}>
            <article className="dash-kpi">
              <span className="dash-kpi__label">Campaigns</span>
              {loading && !data ? (
                <span className="dash-kpi__value">—</span>
              ) : (
                <CountUp className="dash-kpi__value" value={filteredSummary.campaignsTotal} />
              )}
              <span className="dash-kpi__hint">
                {data ? `${filteredSummary.campaignsRunning} running` : ""}
              </span>
            </article>
            <article className="dash-kpi">
              <span className="dash-kpi__label">Contacts</span>
              {loading && !data ? (
                <span className="dash-kpi__value">—</span>
              ) : (
                <CountUp className="dash-kpi__value" value={filteredSummary.contactsTotal} />
              )}
              <span className="dash-kpi__hint">In-range campaigns</span>
            </article>
            <article className="dash-kpi">
              <span className="dash-kpi__label">Call attempts</span>
              {loading && !data ? (
                <span className="dash-kpi__value">—</span>
              ) : (
                <CountUp className="dash-kpi__value" value={filteredSummary.callsTotal} />
              )}
              <span className="dash-kpi__hint">From filtered list</span>
            </article>
            <article className="dash-kpi">
              <span className="dash-kpi__label">SMS attempts</span>
              {loading && !data ? (
                <span className="dash-kpi__value">—</span>
              ) : (
                <CountUp className="dash-kpi__value" value={filteredSummary.smsTotal} />
              )}
              <span className="dash-kpi__hint">From filtered list</span>
            </article>
          </section>
        </div>
      </div>

      <div className="dash-split">
        <section className="panel panel-lift dash-card" aria-labelledby="dash-calls-heading">
          <header className="dash-card__head">
            <h2 id="dash-calls-heading" className="section-title">
              Calls by outcome
            </h2>
            <p className="muted subtle">All-time totals by disposition (API has no per-date breakdown).</p>
          </header>
          <div className="dash-bars">
            {loading && !data ? (
              Array.from({ length: 5 }).map((_, i) => <div key={i} className="shimmer-line wide" />)
            ) : chartsDisabled ? (
              <p className="muted subtle dash-empty">Fix the load error above to see this chart.</p>
            ) : callRows.length === 0 ? (
              <p className="muted subtle dash-empty">No call attempts yet. Run a dial campaign to populate outcomes.</p>
            ) : (
              callRows.map(([k, v]) => <BarRow key={k} label={k} value={v} max={callMax} />)
            )}
          </div>
        </section>

        <section className="panel panel-lift dash-card" aria-labelledby="dash-sms-heading">
          <header className="dash-card__head">
            <h2 id="dash-sms-heading" className="section-title">
              SMS by status
            </h2>
            <p className="muted subtle">All-time totals by delivery state (API has no per-date breakdown).</p>
          </header>
          <div className="dash-bars">
            {loading && !data ? (
              Array.from({ length: 5 }).map((_, i) => <div key={i} className="shimmer-line wide" />)
            ) : chartsDisabled ? (
              <p className="muted subtle dash-empty">Fix the load error above to see this chart.</p>
            ) : smsRows.length === 0 ? (
              <p className="muted subtle dash-empty">No SMS attempts yet. Send SMS from an SMS campaign to populate this.</p>
            ) : (
              smsRows.map(([k, v]) => <BarRow key={k} label={k} value={v} max={smsMax} />)
            )}
          </div>
        </section>
      </div>

      <section className="panel panel-lift" aria-labelledby="dash-campaigns-heading">
        <header className="dash-card__head">
          <h2 id="dash-campaigns-heading" className="section-title">
            Recent campaigns
          </h2>
          <p className="muted subtle">
            Updated in selected range ({filteredCampaigns.length}
            {data ? ` of ${data.campaigns.length}` : ""}).
          </p>
        </header>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Kind</th>
                <th>Status</th>
                <th className="mono">Contacts</th>
                <th className="mono">Calls</th>
                <th className="mono">SMS</th>
                <th>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loading && !data ? (
                <tr>
                  <td colSpan={8} className="muted subtle">
                    Loading campaigns…
                  </td>
                </tr>
              ) : chartsDisabled ? (
                <tr>
                  <td colSpan={8} className="muted subtle">
                    —
                  </td>
                </tr>
              ) : filteredCampaigns.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <div className="empty-state">
                      <p className="empty-state__lede">
                        No campaigns in this date range. Widen the range or create a campaign.
                      </p>
                      <div className="empty-state__actions">
                        <Link className="dashboard-action" to="/new">
                          Create campaign
                        </Link>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredCampaigns.map((c) => (
                  <tr key={c.id}>
                    <td className="fw-medium">{c.name}</td>
                    <td>
                      <span className={`badge ${c.kind === "SMS" ? "badge-kind-sms" : "badge-kind-dial"}`}>{c.kind}</span>
                    </td>
                    <td>
                      <span className={campaignStatusBadgeClass(c.status)}>{c.status}</span>
                    </td>
                    <td className="mono">{c._count.contacts}</td>
                    <td className="mono">{c._count.callAttempts}</td>
                    <td className="mono">{c._count.smsAttempts}</td>
                    <td className="mono subtle">{formatShortDate(c.updatedAt)}</td>
                    <td>
                      <Link className="text-link" to={`/campaigns/${c.id}`}>
                        Open
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel panel-lift" id="activity-log" aria-labelledby="dash-activity-heading">
        <header className="dash-card__head">
          <h2 id="dash-activity-heading" className="section-title">
            Activity log
          </h2>
          <p className="muted subtle">
            Merged stream of calls, SMS, and webhooks in range. Detail level: <strong>{detailLevel}</strong> (change in My
            workspace → Activity).
          </p>
        </header>
        <div className="table-wrap">
          <table className="table dash-activity-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Type</th>
                <th>Summary</th>
                {detailLevel !== "summary" ? <th>Details</th> : null}
                <th />
              </tr>
            </thead>
            <tbody>
              {error && !data ? (
                <tr>
                  <td colSpan={activityCols} className="muted subtle">
                    Unable to load this table. Use the retry control at the top of the page.
                  </td>
                </tr>
              ) : loading && !data ? (
                <tr>
                  <td colSpan={activityCols} className="muted subtle">
                    Loading activity…
                  </td>
                </tr>
              ) : filteredActivity.length ? (
                filteredActivity.map((row) => {
                  const detail = String(row.detail ?? "");
                  return (
                    <tr key={`${row.kind}-${row.id}`}>
                      <td className="mono subtle">{formatShortDate(row.at)}</td>
                      <td>
                        <span className={`dash-pill dash-pill--${row.kind}`}>{row.kind}</span>
                      </td>
                      <td className="fw-medium">{row.label}</td>
                      {detailLevel !== "summary" ? (
                        <td className="muted subtle">
                          {detailLevel === "verbose" ? detail : detail.slice(0, 120)}
                          {detailLevel === "normal" && detail.length > 120 ? "…" : null}
                        </td>
                      ) : null}
                      <td className="dash-activity-actions">
                        {row.campaignId ? (
                          <Link className="text-link" to={`/campaigns/${row.campaignId}`}>
                            Campaign
                          </Link>
                        ) : (
                          <span className="muted subtle">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={activityCols}>
                    <div className="empty-state">
                      <p className="empty-state__lede">No activity in this date range.</p>
                      <div className="empty-state__actions">
                        <Link className="dashboard-action" to="/campaigns">
                          Go to campaigns
                        </Link>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel panel-lift" aria-labelledby="dash-webhook-heading">
        <header className="dash-card__head">
          <h2 id="dash-webhook-heading" className="section-title">
            Webhook log
          </h2>
          <p className="muted subtle">Inbound provider callbacks in the selected range.</p>
        </header>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Provider</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {error && !data ? (
                <tr>
                  <td colSpan={3} className="muted subtle">
                    Unable to load webhooks. Use the retry control at the top of the page.
                  </td>
                </tr>
              ) : loading && !data ? (
                <tr>
                  <td colSpan={3} className="muted subtle">
                    Loading webhooks…
                  </td>
                </tr>
              ) : filteredWebhooks.length ? (
                filteredWebhooks.map((w) => (
                  <tr key={w.id}>
                    <td className="mono subtle">{formatShortDate(w.at)}</td>
                    <td>{w.provider}</td>
                    <td className="muted">{w.type}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} className="muted subtle">
                    No webhook events in this date range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
