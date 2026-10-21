import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Link, useParams } from "react-router-dom";
import { SMS_PER_MINUTE_DEFAULT, SMS_PER_MINUTE_MAX } from "@powerdialer/shared";
import { api } from "../api.js";
import { useAuth } from "../authContext.js";
import { CallSessionTimer } from "../components/CallSessionTimer.js";
import { DispositionChips } from "../components/DispositionChips.js";
import { LiveCallDock } from "../components/LiveCallDock.js";
import { LiveCallRightPanel } from "../components/LiveCallRightPanel.js";
import { LiveWaveform } from "../components/LiveWaveform.js";
import { StatusPill } from "../components/ui/StatusPill.js";
import { isLiveCallRightPanelEnabled } from "../featureFlags.js";
import { formatShortDateTime, formatSmsStatus } from "../format.js";
import { useLicense } from "../licenseContext.js";
import { useNotifier } from "../notifications/context.js";
import { openZoomPhoneCall } from "../zoomPhone.js";

type AgentNextContact = {
  id: string;
  phoneE164: string;
  name: string | null;
  zoomCallUrl: string;
};

type Campaign = {
  id: string;
  name: string;
  kind?: "DIAL" | "SMS";
  status: string;
  fromPhone: string;
  voiceMessage: string;
  voicemailDropEnabled?: boolean;
  voicemailMessage?: string | null;
  hasVoicemailAudio?: boolean;
  voicemailRecordingPath?: string | null;
  smsTemplate?: string | null;
  consentNotes: string;
  consentAttestedAt?: string | null;
  createdAt?: string;
  agentDialMode?: boolean;
  preferredIntegration?: string;
  nextContact?: AgentNextContact | null;
  contacts: { id: string; phoneE164: string; name?: string | null; status: string }[];
  _count?: { contacts: number; callAttempts: number; smsAttempts: number };
};

export function CampaignDetail(): ReactElement {
  const { id } = useParams();
  const { can } = useAuth();
  const { blocksPaid } = useLicense();
  const { pushToast, setActivity } = useNotifier();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [attempts, setAttempts] = useState<{ calls: unknown[]; sms: unknown[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [smsBody, setSmsBody] = useState("");
  const [smsPerMinute, setSmsPerMinute] = useState(SMS_PER_MINUTE_DEFAULT);
  const [editSmsMessage, setEditSmsMessage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showScript, setShowScript] = useState(false);
  const [showAllContacts, setShowAllContacts] = useState(false);
  const [members, setMembers] = useState<Array<{ id: string; name: string; email: string; orgRole?: string }>>([]);
  const [showAssign, setShowAssign] = useState(false);
  const [assignedIds, setAssignedIds] = useState<string[]>([]);
  const [assignBusy, setAssignBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [callEnded, setCallEnded] = useState(false);
  const [importSkippedRows, setImportSkippedRows] = useState<Array<{ phone: string; reason: string }> | null>(
    null,
  );
  const [showImportSkipped, setShowImportSkipped] = useState(false);
  const detailRenderCount = useRef(0);
  detailRenderCount.current += 1;
  if (typeof window !== "undefined") {
    (window as unknown as { __pdDetailRenders?: number }).__pdDetailRenders = detailRenderCount.current;
  }
  const prevStatus = useRef<string | null>(null);
  const scriptAutoOpened = useRef(false);
  const lastCampaignJson = useRef<string | null>(null);
  const lastAttemptsJson = useRef<string | null>(null);

  const canStart = can("campaign_start") && !blocksPaid;
  const canPause = can("campaign_pause");
  const canResume = can("campaign_resume") && !blocksPaid;
  const canImport = can("contact_import") && !blocksPaid;
  const canSms = can("sms_broadcast") && !blocksPaid;
  const canAssign = can("members_manage");

  const refresh = useMemo(() => {
    return async () => {
      if (!id) return;
      const [c, a] = await Promise.all([
        api.campaigns.get(id) as Promise<Campaign>,
        api.campaigns.attempts(id),
      ]);
      // Only re-render when the server data actually changed; polling with
      // identical payloads would otherwise redraw the whole page every tick.
      const cJson = JSON.stringify(c);
      if (cJson !== lastCampaignJson.current) {
        lastCampaignJson.current = cJson;
        setCampaign(c);
      }
      const aJson = JSON.stringify(a);
      if (aJson !== lastAttemptsJson.current) {
        lastAttemptsJson.current = aJson;
        setAttempts(a);
      }
      return c;
    };
  }, [id]);

  useEffect(() => {
    if (!id || !canAssign) return;
    void Promise.all([api.adminAccess.listUsers(), api.org.getAssignments(id)])
      .then(([usersRes, assignRes]) => {
        // Owners/admins already see every campaign — only agents need assigning.
        setMembers(
          usersRes.users
            .filter((u) => (u.orgRole ?? "AGENT") === "AGENT")
            .map((u) => ({ id: u.id, name: u.name, email: u.email, orgRole: u.orgRole })),
        );
        setAssignedIds(assignRes.assignments.map((a) => a.userId));
      })
      .catch(() => undefined);
  }, [id, canAssign]);

  async function saveAssignments(): Promise<void> {
    if (!id) return;
    setAssignBusy(true);
    try {
      await api.org.setAssignments(id, assignedIds);
      pushToast({ variant: "success", title: "Assignments saved", message: "Agents updated for this campaign." });
    } catch (e) {
      pushToast({
        variant: "error",
        title: "Assignment failed",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setAssignBusy(false);
    }
  }

  const contactStatusBreakdown = useMemo(() => {
    if (!campaign) return "";
    const m: Record<string, number> = {};
    for (const c of campaign.contacts) {
      m[c.status] = (m[c.status] ?? 0) + 1;
    }
    return Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}: ${v}`)
      .join(" · ");
  }, [campaign]);

  const liveCallRightPanel = isLiveCallRightPanelEnabled();
  // Flag ON + callEnded: keep live UI so Wrap-Up chips stay reachable (condition 1).
  const liveCallMounted =
    campaign != null &&
    (campaign.kind ?? "DIAL") !== "SMS" &&
    (campaign.status === "RUNNING" || (liveCallRightPanel && callEnded));

  useLayoutEffect(() => {
    if (!liveCallMounted) return;
    document.documentElement.classList.add("call-immersive");
    if (liveCallRightPanel) document.documentElement.classList.add("call-immersive--right-panel");
    return () => {
      document.documentElement.classList.remove("call-immersive");
      document.documentElement.classList.remove("call-immersive--right-panel");
    };
  }, [liveCallMounted, liveCallRightPanel]);

  useEffect(() => {
    if (campaign?.status === "RUNNING") setCallEnded(false);
  }, [campaign?.status]);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    let timer: number | undefined;
    // Poll quickly while dialing is active, slowly otherwise, and pause
    // entirely when the tab is hidden.
    const tick = () => {
      void refresh()
        .then((c) => {
          if (!alive) return;
          setErr(null);
          schedule(c?.status === "RUNNING" ? 4000 : 15000);
        })
        .catch((e: Error) => {
          if (!alive) return;
          setErr(e.message);
          schedule(15000);
        });
    };
    const schedule = (ms: number) => {
      if (!alive) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (document.hidden) {
          schedule(2000);
          return;
        }
        tick();
      }, ms);
    };
    tick();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [id, refresh]);

  useEffect(() => {
    if (campaign?.smsTemplate && !smsBody) setSmsBody(campaign.smsTemplate);
  }, [campaign?.smsTemplate, smsBody]);

  useEffect(() => {
    let alive = true;
    void api.integrations
      .get()
      .then((r) => {
        if (!alive) return;
        const rate = r.preference.smsPerMinute;
        if (typeof rate === "number" && rate >= 1 && rate <= SMS_PER_MINUTE_MAX) setSmsPerMinute(rate);
      })
      .catch(() => {
        /* keep default rate when integrations are offline */
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!campaign || (campaign.kind ?? "DIAL") === "SMS") return;
    if (campaign.status === "RUNNING" && campaign.voiceMessage.trim() && !scriptAutoOpened.current) {
      setShowScript(true);
      scriptAutoOpened.current = true;
    }
  }, [campaign]);

  useEffect(() => {
    if (!campaign || !attempts) return;
    const calls = (attempts.calls as unknown[]).length;
    const sms = (attempts.sms as unknown[]).length;
    const dialing = campaign.contacts.filter((c) => c.status === "DIALING").length;
    const pending = campaign.contacts.filter((c) => c.status === "PENDING").length;
    const kind = campaign.kind ?? "DIAL";
    const kindLabel = kind === "SMS" ? "SMS" : "Dial";
    const detail =
      kind === "SMS"
        ? `${campaign.name} · ${kindLabel} · ${campaign.status} · ${campaign.contacts.length} contacts · ${sms} SMS rows · ${contactStatusBreakdown}`
        : `${campaign.name} · ${kindLabel} · ${campaign.status} · ${campaign.contacts.length} contacts (pending ${pending}, dialing ${dialing}) · ${calls} call rows · ${sms} SMS rows · ${contactStatusBreakdown}`;
    setActivity((prev) => ({
      ...prev,
      detail,
      tone:
        prev.headline.toLowerCase().includes("unreachable")
          ? "warn"
          : campaign.status === "RUNNING"
            ? "busy"
            : "ok",
    }));
    if (prevStatus.current && prevStatus.current !== campaign.status) {
      pushToast({
        variant: "info",
        title: "Campaign status changed",
        message: `${campaign.name} is now ${campaign.status}.`,
      });
    }
    prevStatus.current = campaign.status;
  }, [campaign, attempts, setActivity, pushToast, contactStatusBreakdown]);

  useEffect(() => {
    return () => {
      prevStatus.current = null;
      scriptAutoOpened.current = false;
    };
  }, []);

  async function uploadCsv(file: File | null) {
    if (!id || !file) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.campaigns.importCsv(id, file);
      const dupPart =
        (r.skippedDuplicate ?? 0) > 0 ? `, ${r.skippedDuplicate} duplicates skipped` : "";
      const skipped = r.skippedRows ?? [];
      setImportSkippedRows(skipped.length ? skipped : null);
      setShowImportSkipped(false);
      const extra =
        skipped.length > 0
          ? " Use View skipped below the import control to see each skipped number."
          : "";
      pushToast({
        variant: "success",
        title: "Imported",
        message: `${r.created} imported${dupPart}${r.skipped > (r.skippedDuplicate ?? 0) ? `, ${r.skipped - (r.skippedDuplicate ?? 0)} other skipped` : ""}.${extra}`,
      });
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      pushToast({ variant: "error", title: "Import failed", message: msg });
    } finally {
      setBusy(false);
    }
  }

  async function logAgentDisposition(
    disposition: "COMPLETED" | "NO_ANSWER" | "BUSY" | "FAILED" | "CANCELED",
  ): Promise<void> {
    if (!id || !campaign?.nextContact) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.campaigns.agentDisposition(id, {
        contactId: campaign.nextContact.id,
        disposition,
      });
      pushToast({
        variant: "success",
        title: "Logged",
        message: r.nextContact ? "Ready for the next contact." : "List complete.",
      });
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      pushToast({ variant: "error", title: "Could not log outcome", message: msg });
    } finally {
      setBusy(false);
    }
  }

  async function skipAgentContact(): Promise<void> {
    if (!id || !campaign?.nextContact) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.campaigns.agentSkip(id, { contactId: campaign.nextContact.id });
      pushToast({
        variant: "info",
        title: "Skipped",
        message: r.nextContact ? "Moved to the next contact." : "List complete.",
      });
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      pushToast({ variant: "error", title: "Skip failed", message: msg });
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (!id) return;
    setBusy(true);
    setErr(null);
    const previous = campaign;
    // Optimistic: paint live-call shell immediately with contact we already have
    if (campaign && (campaign.kind ?? "DIAL") !== "SMS") {
      setCampaign({ ...campaign, status: "RUNNING" });
    }
    try {
      if (campaign && (campaign.kind ?? "DIAL") === "SMS") {
        const rate = Math.min(SMS_PER_MINUTE_MAX, Math.max(1, Math.floor(Number(smsPerMinute) || SMS_PER_MINUTE_DEFAULT)));
        void api.integrations.setPreference({ smsPerMinute: rate }).catch(() => undefined);
        const r = await api.campaigns.start(id, {
          body: smsBody.trim() || undefined,
          smsPerMinute: rate,
        });
        pushToast({
          variant: "success",
          title: "SMS started",
          message: `${r.queued ?? 0} contact(s) queued · sending at up to ${r.smsPerMinute ?? rate}/min (status: ${r.status}).`,
        });
      } else {
        await api.campaigns.start(id);
        pushToast({
          variant: "success",
          title: campaign?.agentDialMode ? "Session started" : "Dialing started",
          message: campaign?.agentDialMode
            ? "Use Call in Zoom for each contact, then log the outcome."
            : "Outbound dialing is active pending queue and carrier readiness.",
        });
      }
      await refresh();
    } catch (e) {
      if (previous) setCampaign(previous);
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      pushToast({ variant: "error", title: "Could not start", message: msg });
    } finally {
      setBusy(false);
    }
  }

  async function pause() {
    if (!id) return;
    setBusy(true);
    setErr(null);
    try {
      await api.campaigns.pause(id);
      pushToast({
        variant: "warning",
        title: "Paused",
        message:
          (campaign?.kind ?? "DIAL") === "SMS"
            ? "SMS sending is paused. Press Resume to continue unsent contacts."
            : "New outbound calls are suspended until resume.",
      });
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      pushToast({ variant: "error", title: "Pause failed", message: msg });
    } finally {
      setBusy(false);
    }
  }

  async function resume() {
    if (!id) return;
    setBusy(true);
    setErr(null);
    try {
      const isSmsCampaign = (campaign?.kind ?? "DIAL") === "SMS";
      const rate = Math.min(SMS_PER_MINUTE_MAX, Math.max(1, Math.floor(Number(smsPerMinute) || SMS_PER_MINUTE_DEFAULT)));
      const r = await api.campaigns.resume(
        id,
        isSmsCampaign
          ? {
              // Always send current editor text so Resume uses the edited message.
              body: smsBody.trim() || undefined,
              smsPerMinute: rate,
            }
          : undefined,
      );
      if (isSmsCampaign) setEditSmsMessage(false);
      pushToast({
        variant: "success",
        title: "Resumed",
        message: isSmsCampaign
          ? `${r.queued ?? 0} contact(s) left — continuing with your current message.`
          : "Dialing continues for pending contacts from this state.",
      });
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      pushToast({ variant: "error", title: "Resume failed", message: msg });
    } finally {
      setBusy(false);
    }
  }

  async function saveSmsMessage(): Promise<void> {
    if (!id || (campaign?.kind ?? "DIAL") !== "SMS") return;
    const next = smsBody.trim();
    if (!next) {
      pushToast({ variant: "warning", title: "Message empty", message: "Add SMS text before saving." });
      return;
    }
    setBusy(true);
    try {
      await api.campaigns.saveSmsTemplate(id, next);
      setEditSmsMessage(false);
      pushToast({
        variant: "success",
        title: "Message saved",
        message: "New SMS text will be used for the next sends.",
      });
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pushToast({ variant: "error", title: "Could not save message", message: msg });
    } finally {
      setBusy(false);
    }
  }

  async function sendSms() {
    if (!id) return;
    const rate = Math.min(SMS_PER_MINUTE_MAX, Math.max(1, Math.floor(Number(smsPerMinute) || SMS_PER_MINUTE_DEFAULT)));
    setBusy(true);
    setErr(null);
    try {
      // Persist workspace default so the next campaign remembers this pace.
      void api.integrations.setPreference({ smsPerMinute: rate }).catch(() => undefined);
      const r = await api.campaigns.sms(id, smsBody, { smsPerMinute: rate });
      pushToast({
        variant: "success",
        title: "SMS queued",
        message: `${r.queued} job(s) at up to ${r.smsPerMinute}/min.`,
      });
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      pushToast({ variant: "error", title: "SMS queue failed", message: msg });
    } finally {
      setBusy(false);
    }
  }

  if (!id) return <div className="muted padded">Missing campaign id in the URL.</div>;
  if (!campaign)
    return (
      <div className="detail-stack">
        <p className="back-row">
          <Link className="text-link" to="/campaigns">
            ← Campaigns
          </Link>
        </p>
        <div className="panel shimmer-panel">
          <div className="shimmer-line wide" />
          <div className="shimmer-line" />
          <div className="shimmer-line narrow" />
        </div>
        <p className="muted subtle">Loading…</p>
      </div>
    );

  const isSms = (campaign.kind ?? "DIAL") === "SMS";
  const agentDialMode = Boolean(campaign.agentDialMode);
  const totalContacts = campaign._count?.contacts ?? campaign.contacts.length;
  const callN = campaign._count?.callAttempts;
  const smsN = campaign._count?.smsAttempts;
  const canViewScript = !isSms && campaign.status !== "DRAFT" && campaign.voiceMessage.trim().length > 0;
  // The API returns a tokenized path so the <audio> element can load without auth headers.
  const voicemailRecordingUrl = campaign.voicemailRecordingPath ? `/api${campaign.voicemailRecordingPath}` : null;

  return (
    <div className="detail-stack">
      <div className="campaign-detail-chrome">
      <p className="back-row">
        <Link className="text-link" to="/campaigns">
          ← Campaigns
        </Link>
      </p>

      {isSms ? (
        <div className="panel panel-lift campaign-sms-banner">
          <div className="panel-header-row">
            <div>
              <h2 className="panel-title">{campaign.name}</h2>
              <div className="muted subtle">
                <span className="badge badge-kind-sms">SMS campaign</span> · From{" "}
                <code className="mono">{campaign.fromPhone}</code> ·{" "}
                <span className={`badge badge-${campaign.status.toLowerCase()}`}>{campaign.status}</span>
              </div>
              <p className="muted subtle" style={{ marginTop: 8 }}>
                Press <strong>Start SMS</strong> to text everyone at your chosen pace. Duplicate texts to the same
                number within 15 days are skipped automatically.
              </p>
            </div>
            <div className="btn-row" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
              <label className="field" style={{ margin: 0, minWidth: 140 }}>
                <span className="field-label">Texts per minute</span>
                <input
                  type="number"
                  min={1}
                  max={SMS_PER_MINUTE_MAX}
                  step={1}
                  value={smsPerMinute}
                  disabled={busy}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    if (!Number.isFinite(next)) return;
                    setSmsPerMinute(Math.min(SMS_PER_MINUTE_MAX, Math.max(1, Math.floor(next))));
                  }}
                />
              </label>
              {canStart ? (
                <button
                  className="primary glow-hover"
                  type="button"
                  onClick={start}
                  disabled={busy || totalContacts < 1 || !smsBody.trim()}
                >
                  Start SMS
                </button>
              ) : null}
              {canPause ? (
                <button className="ghost-btn" type="button" onClick={pause} disabled={busy}>
                  Pause
                </button>
              ) : null}
              {canResume ? (
                <button className="ghost-btn" type="button" onClick={resume} disabled={busy}>
                  Resume
                </button>
              ) : null}
            </div>
          </div>
          <details className="consent-snippet muted subtle"><summary>Consent notes</summary>{campaign.consentNotes}</details>
        </div>
      ) : (
        <div className="panel panel-lift">
          <div className="panel-header-row">
            <div>
              <h2 className="panel-title">{campaign.name}</h2>
              <div className="muted subtle">
                <span className="badge badge-kind-dial">Calls</span> · From{" "}
                <code className="mono">{campaign.fromPhone}</code> ·{" "}
                <span className={`badge badge-${campaign.status.toLowerCase()}`}>{campaign.status}</span>
              </div>
              <p className="muted subtle" style={{ marginTop: 8 }}>
                {agentDialMode ? (
                  <>
                    <strong>Zoom Phone mode:</strong> you control each call. <strong>Start session</strong> opens
                    the list; use <strong>Call in Zoom</strong> per contact; log the outcome; <strong>Pause</strong>{" "}
                    when you take a break. Recordings are handled in Zoom Phone (admin setting).
                  </>
                ) : (
                  <>
                    <strong>Start dialing</strong> begins outbound calls; <strong>Pause</strong> halts new dials;{" "}
                    <strong>Resume</strong> continues the queue. SMS is optional below.
                  </>
                )}
              </p>
              {campaign.voicemailDropEnabled && !agentDialMode ? (
                <p className="muted subtle" style={{ marginTop: 8 }}>
                  Voice Mail Drop is enabled for machine-answered calls.
                </p>
              ) : null}
            </div>
            <div className="btn-row">
              {canStart ? (
                <button className="primary pressable" type="button" onClick={start} disabled={busy}>
                  Start dialing
                </button>
              ) : null}
              {canPause ? (
                <button className="ghost-btn" type="button" onClick={pause} disabled={busy}>
                  Pause
                </button>
              ) : null}
              {canResume ? (
                <button className="ghost-btn" type="button" onClick={resume} disabled={busy}>
                  Resume
                </button>
              ) : null}
              {canViewScript ? (
                <button className="ghost-btn" type="button" onClick={() => setShowScript((value) => !value)}>
                  {showScript ? "Hide pre-written script" : "Show pre-written script"}
                </button>
              ) : null}
            </div>
          </div>
          <details className="consent-snippet muted subtle"><summary>Consent notes</summary>{campaign.consentNotes}</details>
        </div>
      )}
      </div>

      {liveCallMounted ? (
        <section
          className={`live-call live-call--connected hero-glow hero-glow--jade${
            liveCallRightPanel ? " live-call--right-panel" : ""
          }`}
          aria-live="polite"
        >
          <div className="live-call__stage">
            <div className="live-call__contact">
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <span className="status-dot" aria-hidden />
                <StatusPill label={callEnded ? "Wrap-Up" : "Connected"} tone={callEnded ? "warn" : "live"} />
              </div>
              <div className="live-call__avatar" aria-hidden>
                {(campaign.nextContact?.name ?? campaign.name).slice(0, 1).toUpperCase()}
              </div>
              <h1 style={{ fontSize: 32, lineHeight: "38px", fontWeight: 600, margin: "12px 0 4px" }}>
                {campaign.nextContact?.name ?? "Next contact"}
              </h1>
              <p className="muted subtle" style={{ margin: 0 }}>
                {campaign.name}
              </p>
              <p className="phone-number" style={{ marginTop: 8, fontSize: 17 }}>
                {campaign.nextContact?.phoneE164 ?? "—"}
              </p>
            </div>
            <div className="void-hero" aria-hidden style={{ height: 64, width: "100%" }} />
            {!liveCallRightPanel ? (
              <CallSessionTimer running={campaign.status === "RUNNING" && !callEnded} />
            ) : null}
            <div className="live-call__progress">
              <div className="live-call__progress-fill" />
            </div>
            <LiveWaveform active={!callEnded} />
            {/* Flag OFF: chips on stage. Flag ON: single mount only in Wrap-Up (never both). */}
            {!liveCallRightPanel ? (
              <>
                <DispositionChips outcome={outcome} onSelect={setOutcome} />
                <p className="muted subtle" style={{ marginTop: 16 }}>
                  {outcome ? `Logged: ${outcome}` : "Log the outcome to continue."}
                </p>
              </>
            ) : null}
          </div>
          {!liveCallRightPanel ? (
            <aside className="panel panel-lift" style={{ alignSelf: "start" }}>
              <h3 className="section-title">Script</h3>
              <p className="muted" style={{ whiteSpace: "pre-wrap" }}>
                {campaign.voiceMessage || "No script set."}
              </p>
            </aside>
          ) : (
            <LiveCallRightPanel
              callEnded={callEnded}
              muted={muted}
              onMute={() => setMuted((m) => !m)}
              onHangup={() => {
                setCallEnded(true);
                void pause();
              }}
              endCallHint="Ending the call pauses dialing — use Session controls (Pause / Resume) on this campaign."
              contactName={campaign.nextContact?.name ?? "Next contact"}
              contactPhone={campaign.nextContact?.phoneE164 ?? "—"}
              campaignName={campaign.name}
              script={
                <p className="muted" style={{ whiteSpace: "pre-wrap", margin: 0 }}>
                  {campaign.voiceMessage || "No script set."}
                </p>
              }
              dispositionSlot={<DispositionChips outcome={outcome} onSelect={setOutcome} />}
              outcome={outcome}
              campaignStatus={campaign.status}
              canPause={canPause && campaign.status === "RUNNING"}
              canResume={canResume && campaign.status === "PAUSED"}
              busy={busy}
              onPause={() => void pause()}
              onResume={() => void resume()}
              canSkip={Boolean(agentDialMode && campaign.nextContact && campaign.status === "RUNNING")}
              onSkip={() => void skipAgentContact()}
              listProgress={{
                total: campaign.contacts.length,
                dialed: campaign.contacts.filter((c) => c.status !== "PENDING").length,
                remaining: campaign.contacts.filter((c) => c.status === "PENDING").length,
              }}
              attemptsForContact={
                campaign.nextContact && attempts?.calls
                  ? (
                      attempts.calls as {
                        contact?: { phoneE164?: string };
                        contactId?: string;
                      }[]
                    ).filter(
                      (x) =>
                        x.contactId === campaign.nextContact?.id ||
                        x.contact?.phoneE164 === campaign.nextContact?.phoneE164,
                    ).length
                  : null
              }
              talkTimeRunning={campaign.status === "RUNNING"}
            />
          )}
          {!liveCallRightPanel ? (
            !callEnded ? (
              <LiveCallDock
                muted={muted}
                onMute={() => setMuted((m) => !m)}
                onHangup={() => {
                  setCallEnded(true);
                  void pause();
                }}
              />
            ) : (
              <p className="call-ended-banner" data-call-ended="true" role="status">
                Call ended
              </p>
            )
          ) : null}
        </section>
      ) : null}

      <div className="campaign-detail-chrome">
      {canAssign ? (
        <section className="panel panel-lift assign-panel">
          <div className="panel-header-row">
            <div>
              <h3 className="section-title">Agents on this campaign</h3>
              <p className="section-lede">
                {assignedIds.length
                  ? `${assignedIds.length} agent${assignedIds.length === 1 ? "" : "s"} assigned.`
                  : "No agents assigned yet — only admins can see this campaign."}
              </p>
            </div>
            <button className="ghost-btn" type="button" onClick={() => setShowAssign((v) => !v)}>
              {showAssign ? "Done" : "Manage agents"}
            </button>
          </div>
          {showAssign ? (
            <>
              {members.length ? (
                <div className="chip-grid">
                  {members.map((m) => {
                    const checked = assignedIds.includes(m.id);
                    return (
                      <label key={m.id} className={`chip-select${checked ? " chip-select--on" : ""}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setAssignedIds((prev) =>
                              checked ? prev.filter((x) => x !== m.id) : [...prev, m.id],
                            )
                          }
                        />
                        <span className="chip-select__name">{m.name}</span>
                        <span className="chip-select__meta">{m.email}</span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p className="muted">
                  No agents yet.{" "}
                  <Link className="text-link" to="/portal/admin">
                    Add an employee
                  </Link>{" "}
                  with the Agent role to assign them here.
                </p>
              )}
              <div className="btn-row" style={{ marginTop: 14 }}>
                <button className="primary" type="button" disabled={assignBusy} onClick={() => void saveAssignments()}>
                  {assignBusy ? "Saving…" : "Save"}
                </button>
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      {!isSms && agentDialMode ? (
        <section className="panel panel-lift agent-dial-panel">
          <h3 className="section-title">Agent dial workspace (Zoom Phone)</h3>
          <p className="section-lede">
            Keep Zoom desktop open and signed in. Enable{" "}
            <strong>Automatically call from 3rd party apps</strong> in Zoom Phone admin settings.
          </p>
          {campaign.status !== "RUNNING" ? (
            <p className="muted subtle">Click <strong>Start session</strong> when you are ready to call.</p>
          ) : campaign.nextContact ? (
            <div className="agent-dial-card">
              <p className="fw-medium" style={{ margin: "0 0 4px" }}>
                {campaign.nextContact.name ?? "Next contact"}
              </p>
              <p className="mono" style={{ margin: "0 0 12px", fontSize: "1.15rem" }}>
                {campaign.nextContact.phoneE164}
              </p>
              <div className="btn-row" style={{ flexWrap: "wrap", gap: 8 }}>
                <button
                  className="primary glow-hover"
                  type="button"
                  disabled={busy}
                  onClick={() => openZoomPhoneCall(campaign.nextContact!.phoneE164, campaign.fromPhone)}
                >
                  Call in Zoom
                </button>
                <button
                  className="ghost-btn"
                  type="button"
                  disabled={busy}
                  onClick={() => void logAgentDisposition("COMPLETED")}
                >
                  Connected
                </button>
                <button
                  className="ghost-btn"
                  type="button"
                  disabled={busy}
                  onClick={() => void logAgentDisposition("NO_ANSWER")}
                >
                  No answer
                </button>
                <button
                  className="ghost-btn"
                  type="button"
                  disabled={busy}
                  onClick={() => void logAgentDisposition("BUSY")}
                >
                  Busy
                </button>
                <button
                  className="ghost-btn"
                  type="button"
                  disabled={busy}
                  onClick={() => void skipAgentContact()}
                >
                  Skip
                </button>
              </div>
            </div>
          ) : (
            <p className="muted subtle">No pending contacts — import more or mark this campaign complete.</p>
          )}
        </section>
      ) : null}

      {!isSms && canViewScript && showScript ? (
        <div className="panel panel-lift script-panel">
          <h3 className="section-title">Pre-written script</h3>
          <p className="section-lede">
            Open this while dialing so the agent can stay on message without leaving the campaign screen.
          </p>
          <div className="script-panel__body">{campaign.voiceMessage}</div>
        </div>
      ) : null}

      {!isSms && campaign.voicemailDropEnabled && !agentDialMode ? (
        <div className="panel panel-lift voicemail-summary">
          <h3 className="section-title">Voice Mail Drop</h3>
          <p className="section-lede">
            If Twilio detects voicemail, the drop message is used after the beep instead of the standard script.
          </p>
          {voicemailRecordingUrl ? (
            <div>
              <span className="badge badge-running">Recorded drop attached</span>
              <audio className="voicemail-summary__player" controls src={voicemailRecordingUrl} />
            </div>
          ) : null}
          {campaign.voicemailMessage ? (
            <p className="muted subtle" style={{ marginTop: voicemailRecordingUrl ? 12 : 0, whiteSpace: "pre-wrap" }}>
              Text fallback: {campaign.voicemailMessage}
            </p>
          ) : null}
          {!voicemailRecordingUrl && !campaign.voicemailMessage ? (
            <p className="muted subtle" style={{ marginTop: 0 }}>
              No voicemail payload is attached yet.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="meta-grid" aria-label="Campaign summary">
        <div className="meta-grid__item">
          <span className="meta-grid__label">Contacts (view)</span>
          <span className="meta-grid__value">{totalContacts}</span>
        </div>
        {typeof callN === "number" ? (
          <div className="meta-grid__item">
            <span className="meta-grid__label">Calls logged</span>
            <span className="meta-grid__value">{callN}</span>
          </div>
        ) : null}
        {typeof smsN === "number" ? (
          <div className="meta-grid__item">
            <span className="meta-grid__label">SMS logged</span>
            <span className="meta-grid__value">{smsN}</span>
          </div>
        ) : null}
        {campaign.createdAt ? (
          <div className="meta-grid__item">
            <span className="meta-grid__label">Created</span>
            <span className="meta-grid__value" style={{ fontSize: "0.95rem" }}>
              {formatShortDateTime(campaign.createdAt)}
            </span>
          </div>
        ) : null}
        {campaign.consentAttestedAt ? (
          <div className="meta-grid__item">
            <span className="meta-grid__label">Attested</span>
            <span className="meta-grid__value" style={{ fontSize: "0.95rem" }}>
              {formatShortDateTime(campaign.consentAttestedAt)}
            </span>
          </div>
        ) : null}
      </div>

      {canImport && (isSms || totalContacts < 1) ? (
        <div className="panel panel-lift">
          <h3 className="section-title">
            {isSms ? "Add contacts (CSV)" : "Import contacts (CSV)"}
          </h3>
          <p className="section-lede">
            {isSms ? (
              <>
                Upload a CSV (needs a <code className="mono">phone</code> column), then press{" "}
                <strong>Start SMS</strong>. Duplicate phones in the file are skipped — use{" "}
                <strong>View skipped</strong> after import.
              </>
            ) : (
              <>
                CSV requires a <code className="mono">phone</code> column; DNC matches are excluded automatically.
              </>
            )}
          </p>
          <label className="file-drop" style={{ marginTop: 12 }}>
            <input
              name="file"
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              onChange={(e) => uploadCsv(e.target.files?.[0] ?? null)}
            />
            <span className="file-drop-label">{busy ? "Processing…" : "Select or drop a CSV file"}</span>
          </label>
          {importSkippedRows && importSkippedRows.length > 0 ? (
            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                className="ghost-btn btn-32"
                onClick={() => setShowImportSkipped((v) => !v)}
              >
                {showImportSkipped ? "Hide skipped" : `View skipped (${importSkippedRows.length})`}
              </button>
              {showImportSkipped ? (
                <ul className="muted subtle" style={{ marginTop: 8, paddingLeft: 18 }}>
                  {importSkippedRows.map((row, i) => (
                    <li key={`${row.phone}-${i}`}>
                      <span className="mono">{row.phone}</span> — {row.reason}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : !isSms && canImport ? (
        <div className="panel panel-lift">
          <h3 className="section-title">Import contacts (CSV)</h3>
          <p className="section-lede">
            CSV requires a <code className="mono">phone</code> column; DNC matches are excluded automatically.
          </p>
          <label className="file-drop" style={{ marginTop: 12 }}>
            <input
              name="file"
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              onChange={(e) => uploadCsv(e.target.files?.[0] ?? null)}
            />
            <span className="file-drop-label">{busy ? "Processing…" : "Select or drop a CSV file"}</span>
          </label>
          {importSkippedRows && importSkippedRows.length > 0 ? (
            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                className="ghost-btn btn-32"
                onClick={() => setShowImportSkipped((v) => !v)}
              >
                {showImportSkipped ? "Hide skipped" : `View skipped (${importSkippedRows.length})`}
              </button>
              {showImportSkipped ? (
                <ul className="muted subtle" style={{ marginTop: 8, paddingLeft: 18 }}>
                  {importSkippedRows.map((row, i) => (
                    <li key={`${row.phone}-${i}`}>
                      <span className="mono">{row.phone}</span> — {row.reason}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {(isSms || canSms) ? (
      <div className="panel panel-lift messenger-panel">
        <h3 className="section-title">{isSms ? "Message" : "SMS broadcast (optional)"}</h3>
        <p className="section-lede">
          {isSms
            ? "This is the text each contact receives."
            : "Optionally text your contacts alongside dialing."}
        </p>
        {isSms && !editSmsMessage ? (
          <>
            <div className="msg-composer" style={{ whiteSpace: "pre-wrap", minHeight: 88 }}>
              {smsBody.trim() || <span className="muted">No message saved yet.</span>}
            </div>
            <div className="composer-actions" style={{ marginTop: 12 }}>
              <button className="ghost-btn" type="button" onClick={() => setEditSmsMessage(true)} disabled={busy}>
                Edit message
              </button>
            </div>
          </>
        ) : (
          <>
            <textarea
              className="msg-composer"
              placeholder="Message body (include opt-out where required)…"
              value={smsBody}
              maxLength={1600}
              onChange={(e) => setSmsBody(e.target.value)}
            />
            <p className="field-hint">Merge field {"{{name}}"} supported when names are present.</p>
            <div className="char-count" aria-live="polite">
              {smsBody.length} / 1600 characters
            </div>
            {isSms ? (
              <div className="composer-actions">
                <button className="primary" type="button" onClick={() => void saveSmsMessage()} disabled={busy}>
                  Save message
                </button>
                <button className="ghost-btn" type="button" onClick={() => setEditSmsMessage(false)} disabled={busy}>
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <label className="field" style={{ display: "block", marginTop: 12, maxWidth: 280 }}>
                  <span className="field-label">SMS per minute (max {SMS_PER_MINUTE_MAX})</span>
                  <input
                    type="number"
                    min={1}
                    max={SMS_PER_MINUTE_MAX}
                    step={1}
                    value={smsPerMinute}
                    disabled={busy}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      if (!Number.isFinite(next)) return;
                      setSmsPerMinute(Math.min(SMS_PER_MINUTE_MAX, Math.max(1, Math.floor(next))));
                    }}
                  />
                  <span className="field-hint">
                    Up to {SMS_PER_MINUTE_MAX} per minute.
                  </span>
                </label>
                <div className="composer-actions">
                  <button
                    className="primary glow-hover"
                    type="button"
                    onClick={sendSms}
                    disabled={busy || !smsBody.trim()}
                  >
                    Queue SMS to all contacts
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
      ) : null}

      {err ? <div className="error panel panel-lift shake-once">{err}</div> : null}

      <div className="panel panel-lift">
        <h3 className="section-title">Contacts</h3>
        <p className="section-lede">
          {totalContacts > campaign.contacts.length
            ? `Showing ${campaign.contacts.length.toLocaleString()} of ${totalContacts.toLocaleString()} contacts. Updates automatically.`
            : "Updates automatically while this page is open."}
        </p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Phone</th>
                <th scope="col">Name</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {(showAllContacts ? campaign.contacts : campaign.contacts.slice(0, 120)).map((c) => (
                <tr key={c.id}>
                  <td>
                    <span className="mono">{c.phoneE164}</span>
                  </td>
                  <td>{c.name ?? "—"}</td>
                  <td>
                    <span className={`pill pill-${c.status.toLowerCase()}`} title={`Contact status: ${c.status}`}>
                      {c.status === "SKIPPED" ? "Skipped" : c.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!showAllContacts && campaign.contacts.length > 120 ? (
          <button
            type="button"
            className="ghost-btn"
            style={{ marginTop: 8 }}
            onClick={() => setShowAllContacts(true)}
          >
            Show loaded rows ({campaign.contacts.length.toLocaleString()}
            {totalContacts > campaign.contacts.length
              ? ` of ${totalContacts.toLocaleString()} total`
              : ""}
            )
          </button>
        ) : null}
        {contactStatusBreakdown ? (
          <p className="status-legend">Current distribution: {contactStatusBreakdown}</p>
        ) : null}
      </div>

      <div className="panel panel-lift">
        <h3 className="section-title">Recent attempts</h3>
        <p className="section-lede">Call dispositions and SMS job status for audit and troubleshooting.</p>
        {!attempts ? (
          <div className="muted">Loading…</div>
        ) : (
          <div className={`row attempts-grid ${isSms ? "attempts-grid--sms-only" : ""}`}>
            {!isSms ? (
              <div>
                <div className="muted subtle" style={{ marginBottom: 6 }}>
                  Calls
                </div>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">To</th>
                        <th scope="col">Outcome</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(attempts.calls as { id: string; disposition: string; contact: { phoneE164: string } }[]).map(
                        (x) => (
                          <tr key={x.id}>
                            <td className="mono">{x.contact.phoneE164}</td>
                            <td>
                              <span className="pill pill-muted">{x.disposition}</span>
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
                {(attempts.calls as unknown[]).length === 0 ? (
                  <p className="muted subtle" style={{ marginTop: 8 }}>
                    No call attempts recorded; start dialing to populate this log.
                  </p>
                ) : null}
              </div>
            ) : null}
            <div>
              <div className="muted subtle" style={{ marginBottom: 6 }}>
                Texts
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">To</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(
                      attempts.sms as {
                        id: string;
                        status: string;
                        rawPayload?: unknown;
                        contact: { phoneE164: string };
                      }[]
                    ).map((x) => (
                      <tr key={x.id}>
                        <td className="mono">{x.contact.phoneE164}</td>
                        <td>
                          <span className="pill pill-muted">{formatSmsStatus(x)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(attempts.sms as unknown[]).length === 0 ? (
                <p className="muted subtle" style={{ marginTop: 8 }}>
                  No SMS attempts recorded; queue a broadcast above to populate this log.
                </p>
              ) : null}
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
