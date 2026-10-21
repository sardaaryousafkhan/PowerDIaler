import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { AppLogoMark } from "../components/AppLogo.js";
import { CountUp } from "../components/CountUp.js";
import { VirtualizedRows } from "../components/VirtualizedRows.js";
import { formatShortDateTime } from "../format.js";
import { useNotifier } from "../notifications/context.js";
import { useAuth } from "../authContext.js";

type Row = {
  id: string;
  name: string;
  kind?: "DIAL" | "SMS";
  status: string;
  createdAt: string;
  _count?: { contacts: number };
};

type Filter = "all" | "running" | "dial" | "sms";

type PreviewCampaign = {
  id: string;
  name: string;
  kind?: "DIAL" | "SMS";
  status: string;
  _count?: { contacts: number; callAttempts: number; smsAttempts: number };
  contacts?: unknown[];
};

function campaignStatusBadgeClass(status: string): string {
  const s = status.toLowerCase();
  return `badge badge-${s}`;
}

export function CampaignList(): ReactElement {
  const { pushToast } = useNotifier();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewCampaign | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [startBusy, setStartBusy] = useState(false);
  const { user, can } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "owner";
  const canStart = can("campaign_start");

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = (await api.campaigns.list()) as Row[];
      setRows(r);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      pushToast({ variant: "error", title: "Could not load campaigns", message: msg });
    }
  }, [pushToast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // Prefetch detail chunk so Open row clicks aren't waiting on JS download
    void import("./CampaignDetail.js").catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setPreview(null);
      setPreviewErr(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewErr(null);
    void api.campaigns
      .get(selectedId)
      .then((raw) => {
        if (cancelled) return;
        setPreview(raw as PreviewCampaign);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setPreview(null);
        setPreviewErr(e instanceof Error ? e.message : "Could not load preview.");
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const metrics = useMemo(() => {
    if (!rows) return { total: 0, running: 0, sms: 0, contacts: 0 };
    const total = rows.length;
    const running = rows.filter((r) => r.status === "RUNNING").length;
    const sms = rows.filter((r) => (r.kind ?? "DIAL") === "SMS").length;
    const contacts = rows.reduce((sum, r) => sum + (r._count?.contacts ?? 0), 0);
    return { total, running, sms, contacts };
  }, [rows]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    if (filter === "running") return rows.filter((r) => r.status === "RUNNING");
    if (filter === "dial") return rows.filter((r) => (r.kind ?? "DIAL") === "DIAL");
    if (filter === "sms") return rows.filter((r) => (r.kind ?? "DIAL") === "SMS");
    return rows;
  }, [rows, filter]);

  useEffect(() => {
    if (!filtered.length) {
      setSelectedId(null);
      return;
    }
    if (selectedId && filtered.some((r) => r.id === selectedId)) return;
    setSelectedId(filtered[0]!.id);
  }, [filtered, selectedId]);

  async function confirmDeleteCampaign(): Promise<void> {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await api.campaigns.delete(deleteTarget.id);
      pushToast({
        variant: "success",
        title: "Campaign deleted",
        message: `${deleteTarget.name} was removed.`,
      });
      if (selectedId === deleteTarget.id) setSelectedId(null);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pushToast({ variant: "error", title: "Delete failed", message: msg });
    } finally {
      setDeleteBusy(false);
    }
  }

  if (err && !rows) {
    return (
      <div className="detail-stack campaigns-page page-enter">
        <header className="page-hero">
          <h2 className="page-hero__title">Campaigns</h2>
          <p className="page-hero__lede">The list could not be loaded; verify the API and try again.</p>
        </header>
        <div className="panel panel-lift">
          <p className="error" style={{ marginTop: 0 }}>
            {err}
          </p>
          <button type="button" className="primary pressable" onClick={() => void load()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!rows) {
    return (
      <div className="detail-stack campaigns-page">
        <header className="page-hero">
          <h2 className="page-hero__title">Campaigns</h2>
          <p className="page-hero__lede">Loading…</p>
        </header>
        <div className="panel shimmer-panel" style={{ minHeight: 200 }}>
          <div className="shimmer-line wide" />
          <div className="shimmer-line" />
          <div className="shimmer-line narrow" />
        </div>
      </div>
    );
  }

  const contactCount =
    preview?._count?.contacts ??
    (Array.isArray(preview?.contacts) ? preview.contacts.length : null) ??
    filtered.find((r) => r.id === selectedId)?._count?.contacts ??
    0;
  const callCount = preview?._count?.callAttempts ?? 0;
  const smsCount = preview?._count?.smsAttempts ?? 0;
  const previewKind = preview?.kind ?? filtered.find((r) => r.id === selectedId)?.kind ?? "DIAL";
  const previewStatus = preview?.status ?? filtered.find((r) => r.id === selectedId)?.status ?? "";

  return (
    <div className="detail-stack campaigns-page page-enter hero-glow">
      <header className="page-hero">
        <h2 className="page-hero__title">Campaigns</h2>
        <p className="page-hero__lede">
          Select a row to preview; open the full page to manage contacts, SMS, or dialing.{" "}
          <Link className="text-link" to="/dnc">
            DNC
          </Link>{" "}
          entries apply automatically on CSV import.
        </p>
      </header>

      <div className="void-hero" aria-hidden style={{ height: 64 }} />

      <section className="dash-kpi-row" aria-label="Campaign overview">
        <article className="dash-kpi">
          <span className="dash-kpi__label">Total</span>
          <CountUp className="dash-kpi__value" value={metrics.total} />
        </article>
        <article className="dash-kpi">
          <span className="dash-kpi__label">Running</span>
          <CountUp className="dash-kpi__value" value={metrics.running} />
        </article>
        <article className="dash-kpi">
          <span className="dash-kpi__label">SMS</span>
          <CountUp className="dash-kpi__value" value={metrics.sms} />
        </article>
        <article className="dash-kpi">
          <span className="dash-kpi__label">Contacts</span>
          <CountUp className="dash-kpi__value" value={metrics.contacts} />
        </article>
      </section>

      <div className="campaign-filters" role="toolbar" aria-label="Filter campaigns">
        {(
          [
            ["all", "All"],
            ["running", "Running"],
            ["dial", "Calls"],
            ["sms", "SMS"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`filter-chip${filter === id ? " filter-chip--on" : ""}`}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__mark">
            <AppLogoMark size={64} />
          </div>
          <h3 className="empty-state__title">No campaigns yet</h3>
          <p className="empty-state__body">Create a campaign to begin; setup typically takes about one minute.</p>
          <Link className="primary pressable" to="/new" style={{ display: "inline-flex" }}>
            New campaign
          </Link>
        </div>
      ) : (
        <div className="campaigns-master">
          <div className="campaigns-master__list">
            <VirtualizedRows
              className="campaign-rows"
              items={filtered}
              getKey={(c) => c.id}
              renderRow={(c) => (
                <div
                  className={`campaign-row${selectedId === c.id ? " campaign-row--selected" : ""}`}
                  role="listitem"
                  data-status={c.status}
                  tabIndex={0}
                  onClick={() => setSelectedId(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedId(c.id);
                    }
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    {c.status === "RUNNING" ? <span className="status-dot" aria-hidden /> : null}
                    <span className="campaign-row__name">{c.name}</span>
                  </div>
                  <span className={`badge ${(c.kind ?? "DIAL") === "SMS" ? "badge-kind-sms" : "badge-kind-dial"}`}>
                    {(c.kind ?? "DIAL") === "SMS" ? "SMS" : "Calls"}
                  </span>
                  <span className={campaignStatusBadgeClass(c.status)}>{c.status}</span>
                  <span className="campaign-row__meta">{c._count?.contacts ?? "—"}</span>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span className="campaign-row__meta" style={{ display: "none" }}>
                      {formatShortDateTime(c.createdAt)}
                    </span>
                    <Link
                      className="campaign-row__start"
                      to={`/campaigns/${c.id}`}
                      onClick={(e) => e.stopPropagation()}
                      onPointerEnter={() => {
                        void import("./CampaignDetail.js").catch(() => undefined);
                      }}
                    >
                      Open
                    </Link>
                    {isAdmin ? (
                      <button
                        type="button"
                        className="ghost-btn btn-32"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget({ id: c.id, name: c.name });
                        }}
                        aria-label={`Delete campaign ${c.name}`}
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                </div>
              )}
            />
          </div>

          <aside className="campaigns-master__preview" aria-label="Campaign preview">
            {!selectedId ? (
              <p className="campaigns-master__preview-empty">Select a campaign to preview.</p>
            ) : previewLoading && !preview ? (
              <div className="campaigns-preview">
                <div className="shimmer-line wide" />
                <div className="shimmer-line" />
                <div className="shimmer-line narrow" />
              </div>
            ) : previewErr ? (
              <div className="campaigns-preview">
                <p className="error" style={{ margin: 0 }}>
                  {previewErr}
                </p>
                <Link className="primary pressable" to={`/campaigns/${selectedId}`}>
                  Open campaign
                </Link>
              </div>
            ) : (
              <div className="campaigns-preview">
                <h3 className="campaigns-preview__title">{preview?.name ?? "Campaign"}</h3>
                <div className="campaigns-preview__meta">
                  <span className={`badge ${previewKind === "SMS" ? "badge-kind-sms" : "badge-kind-dial"}`}>
                    {previewKind === "SMS" ? "SMS" : "Calls"}
                  </span>
                  {previewStatus ? (
                    <span className={campaignStatusBadgeClass(previewStatus)}>{previewStatus}</span>
                  ) : null}
                </div>
                <div className="campaigns-preview__stats">
                  <div className="campaigns-preview__stat">
                    <span className="campaigns-preview__stat-label">Contacts</span>
                    <span className="campaigns-preview__stat-value">{contactCount}</span>
                  </div>
                  <div className="campaigns-preview__stat">
                    <span className="campaigns-preview__stat-label">Calls</span>
                    <span className="campaigns-preview__stat-value">{callCount}</span>
                  </div>
                  <div className="campaigns-preview__stat">
                    <span className="campaigns-preview__stat-label">SMS</span>
                    <span className="campaigns-preview__stat-value">{smsCount}</span>
                  </div>
                </div>
                <div className="campaigns-preview__actions">
                  <Link className="ghost-btn" to={`/campaigns/${selectedId}`}>
                    Open campaign
                  </Link>
                  {canStart && previewKind !== "SMS" && previewStatus !== "RUNNING" ? (
                    <button
                      type="button"
                      className="primary pressable"
                      disabled={startBusy || (contactCount ?? 0) < 1}
                      onClick={() => {
                        if (!selectedId) return;
                        setStartBusy(true);
                        void (async () => {
                          try {
                            await api.campaigns.start(selectedId);
                            pushToast({
                              variant: "success",
                              title: "Dialing started",
                              message: "Opening the live call workspace.",
                            });
                            navigate(`/campaigns/${selectedId}`);
                          } catch (e: unknown) {
                            const msg = e instanceof Error ? e.message : String(e);
                            pushToast({ variant: "error", title: "Could not start dialing", message: msg });
                          } finally {
                            setStartBusy(false);
                          }
                        })();
                      }}
                    >
                      {startBusy ? "Starting…" : "Start dialing"}
                    </button>
                  ) : null}
                  {canStart && previewKind === "SMS" && previewStatus !== "RUNNING" ? (
                    <Link className="primary pressable" to={`/campaigns/${selectedId}`}>
                      Open to send SMS
                    </Link>
                  ) : null}
                </div>
              </div>
            )}
          </aside>
        </div>
      )}

      {deleteTarget ? (
        <div className="setup-modal-backdrop" role="presentation">
          <section
            className="setup-modal panel panel-lift"
            role="dialog"
            aria-modal="true"
            aria-label="Confirm campaign delete"
          >
            <h3 className="section-title" style={{ marginTop: 0 }}>
              Confirm deletion
            </h3>
            <p className="muted" style={{ marginBottom: 0 }}>
              Are you sure you want to delete <strong>{deleteTarget.name}</strong>?
            </p>
            <p className="muted subtle" style={{ marginTop: 6 }}>
              This action cannot be undone.
            </p>
            <div className="integration-toolbar" style={{ marginTop: 14 }}>
              <button
                type="button"
                className="danger-btn"
                disabled={deleteBusy}
                onClick={() => void confirmDeleteCampaign()}
              >
                {deleteBusy ? "Deleting…" : "Yes, delete"}
              </button>
              <button
                type="button"
                className="ghost-btn"
                disabled={deleteBusy}
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
