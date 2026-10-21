import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ComingSoonGroup } from "./ComingSoonGroup.js";
import { CallSessionTimer } from "./CallSessionTimer.js";
import { LiveCallDock } from "./LiveCallDock.js";

export type LiveCallPanelSection = "control" | "contact" | "wrapup" | "session" | "insights";

const SECTIONS: { id: LiveCallPanelSection; label: string; short: string }[] = [
  { id: "control", label: "Call Control", short: "Call" },
  { id: "contact", label: "Contact / Lead", short: "Contact" },
  { id: "wrapup", label: "Wrap-Up", short: "Wrap" },
  { id: "session", label: "Session", short: "Session" },
  { id: "insights", label: "Insights", short: "Insights" },
];

function dialerStatusLabel(status: string, callEnded: boolean): string {
  if (callEnded) return "Wrap-Up";
  const s = status.toUpperCase();
  if (s === "RUNNING") return "Connected";
  if (s === "PAUSED") return "Paused";
  if (s === "DRAFT") return "Ready";
  if (s === "COMPLETED") return "Ready";
  return status;
}

export function LiveCallRightPanel({
  callEnded,
  muted,
  onMute,
  onHangup,
  endCallHint,
  contactName,
  contactPhone,
  campaignName,
  script,
  dispositionSlot,
  outcome,
  campaignStatus,
  canPause,
  canResume,
  busy,
  onPause,
  onResume,
  canSkip,
  onSkip,
  listProgress,
  attemptsForContact,
  talkTimeRunning,
}: {
  callEnded: boolean;
  muted: boolean;
  onMute: () => void;
  onHangup: () => void;
  endCallHint: string | null;
  contactName: string;
  contactPhone: string;
  campaignName: string;
  script: ReactNode;
  /** Single DispositionChips mount — passed in, not duplicated */
  dispositionSlot: ReactNode;
  outcome: string | null;
  campaignStatus: string;
  canPause: boolean;
  canResume: boolean;
  busy: boolean;
  onPause: () => void;
  onResume: () => void;
  canSkip: boolean;
  onSkip: () => void;
  listProgress: { remaining: number; dialed: number; total: number };
  attemptsForContact: number | null;
  talkTimeRunning: boolean;
}): ReactElement {
  const [collapsed, setCollapsed] = useState(false);
  const [section, setSection] = useState<LiveCallPanelSection>("control");

  // Condition 1: callEnded → auto-expand + focus Wrap-Up (chips must stay reachable).
  useEffect(() => {
    if (!callEnded) return;
    setCollapsed(false);
    setSection("wrapup");
  }, [callEnded]);

  if (collapsed) {
    return (
      <aside className="live-call-panel live-call-panel--collapsed" aria-label="Live call panel">
        <button
          type="button"
          className="live-call-panel__expand"
          aria-expanded={false}
          aria-label="Expand live call panel"
          onClick={() => setCollapsed(false)}
        >
          ›
        </button>
        <nav className="live-call-panel__rail" aria-label="Live call sections">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`live-call-panel__rail-btn${section === s.id ? " live-call-panel__rail-btn--on" : ""}${
                callEnded && s.id === "wrapup" ? " live-call-panel__rail-btn--badge" : ""
              }`}
              title={s.label}
              aria-label={
                callEnded && s.id === "wrapup" ? `${s.label} — disposition needed` : s.label
              }
              onClick={() => {
                setSection(s.id);
                setCollapsed(false);
              }}
            >
              {s.short.slice(0, 1)}
              {callEnded && s.id === "wrapup" ? (
                <span className="live-call-panel__badge" aria-hidden>
                  !
                </span>
              ) : null}
            </button>
          ))}
        </nav>
      </aside>
    );
  }

  return (
    <aside className="live-call-panel" aria-label="Live call panel">
      <div className="live-call-panel__chrome">
        <nav className="live-call-panel__tabs" aria-label="Live call sections">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`live-call-panel__tab${section === s.id ? " live-call-panel__tab--on" : ""}${
                callEnded && s.id === "wrapup" ? " live-call-panel__tab--badge" : ""
              }`}
              aria-current={section === s.id ? "true" : undefined}
              onClick={() => setSection(s.id)}
            >
              {s.label}
              {callEnded && s.id === "wrapup" ? (
                <span className="live-call-panel__badge" aria-hidden>
                  !
                </span>
              ) : null}
            </button>
          ))}
        </nav>
        <button
          type="button"
          className="ghost-btn btn-32 live-call-panel__collapse"
          aria-expanded={true}
          aria-label="Collapse live call panel"
          onClick={() => setCollapsed(true)}
        >
          ‹
        </button>
      </div>

      <div className="live-call-panel__body">
        {section === "control" ? (
          <section className="live-call-panel__section" aria-label="Call Control">
            <h3 className="section-title">Call Control</h3>
            <LiveCallDock
              layout="stack"
              muted={muted}
              onMute={onMute}
              onHangup={onHangup}
              endCallHint={endCallHint}
            />
            <ComingSoonGroup
              tooltip="Not yet supported by carrier — coming soon."
              items={[
                {
                  label: "Warm Transfer",
                  reason: "Not yet supported by carrier — coming soon.",
                },
                {
                  label: "Blind Transfer",
                  reason: "Not yet supported by carrier — coming soon.",
                },
                {
                  label: "Transfer directory",
                  reason: "Not yet supported by carrier — coming soon.",
                },
                {
                  label: "Add Participant",
                  reason: "Not yet supported — coming soon.",
                },
                {
                  label: "Record Toggle",
                  reason: "Recording is managed in Zoom Phone — in-app toggle coming soon.",
                },
              ]}
            />
          </section>
        ) : null}

        {section === "contact" ? (
          <section className="live-call-panel__section" aria-label="Contact / Lead">
            <h3 className="section-title">Contact / Lead</h3>
            <div className="live-call-panel__profile">
              <p className="fw-medium" style={{ margin: "0 0 4px", fontSize: 18 }}>
                {contactName}
              </p>
              <p className="muted subtle" style={{ margin: "0 0 8px" }}>
                {campaignName}
              </p>
              <p className="phone-number mono" style={{ margin: 0 }}>
                {contactPhone}
              </p>
            </div>
            <div className="live-call-panel__script">
              <h4 className="live-call-panel__subhead">Script</h4>
              {script}
            </div>
            <ComingSoonGroup
              items={[
                { label: "Email", reason: "Not on contact payload — coming soon." },
                { label: "Time zone", reason: "Not on contact payload — coming soon." },
                { label: "Emails Sent", reason: "Not available in this session — coming soon." },
                { label: "SMS Thread", reason: "Not available in this session — coming soon." },
                { label: "CRM Fields", reason: "Edit on CRM page — live panel fields coming soon." },
                { label: "Open in CRM", reason: "Deep-link quick action coming soon." },
                { label: "Drop Voicemail", reason: "Manual drop from panel coming soon." },
                { label: "Send SMS Template", reason: "Use campaign SMS tools — panel action coming soon." },
              ]}
            />
          </section>
        ) : null}

        {section === "wrapup" ? (
          <section className="live-call-panel__section" aria-label="Wrap-Up">
            <h3 className="section-title">Wrap-Up</h3>
            {/* Backlog: mandatory disposition dropdown — chips stay this pass. */}
            <p className="muted subtle" style={{ marginTop: 0 }}>
              {outcome ? `Logged: ${outcome}` : "Log the outcome to continue."}
            </p>
            {dispositionSlot}
            <ComingSoonGroup
              items={[
                { label: "Notes", reason: "Wrap-up notes coming soon." },
                { label: "Schedule Callback", reason: "Date/time picker coming soon." },
                { label: "Add to Nurture Sequence", reason: "Not yet supported — coming soon." },
                { label: "Tags", reason: "Quick-add tags coming soon." },
              ]}
            />
          </section>
        ) : null}

        {section === "session" ? (
          <section className="live-call-panel__section" aria-label="Session">
            <h3 className="section-title">Session</h3>
            <p className="live-call-panel__status">
              Dialer status:{" "}
              <strong>{dialerStatusLabel(campaignStatus, callEnded)}</strong>
            </p>
            <div className="btn-row" style={{ flexWrap: "wrap", gap: 8, marginTop: 12 }}>
              {canPause ? (
                <button className="ghost-btn" type="button" onClick={onPause} disabled={busy || callEnded}>
                  Pause Session
                </button>
              ) : null}
              {canResume ? (
                <button className="ghost-btn" type="button" onClick={onResume} disabled={busy}>
                  Resume Session
                </button>
              ) : null}
              {canSkip ? (
                <button className="ghost-btn" type="button" onClick={onSkip} disabled={busy}>
                  Skip Contact
                </button>
              ) : null}
            </div>
            <div className="live-call-panel__progress" style={{ marginTop: 16 }}>
              <h4 className="live-call-panel__subhead">List Progress</h4>
              <p className="muted subtle" style={{ margin: 0 }}>
                Remaining {listProgress.remaining} · Dialed {listProgress.dialed} · Total {listProgress.total}
              </p>
            </div>
            {/* Pacing: existing control is SMS rate — keep original label elsewhere; stub dialer pacing. */}
            <ComingSoonGroup
              items={[
                {
                  label: "Pacing Control",
                  reason: "Dialer pacing control coming soon (SMS rate lives on the campaign page).",
                },
              ]}
            />
          </section>
        ) : null}

        {section === "insights" ? (
          <section className="live-call-panel__section" aria-label="Insights">
            <h3 className="section-title">Insights</h3>
            <div className="live-call-panel__metric">
              <span className="muted subtle">Talk Time</span>
              <CallSessionTimer running={talkTimeRunning && !callEnded} className="live-call-panel__talk-time tabular" />
            </div>
            {attemptsForContact != null ? (
              <div className="live-call-panel__metric">
                <span className="muted subtle">Attempts per Contact</span>
                <strong>{attemptsForContact}</strong>
              </div>
            ) : null}
            <ComingSoonGroup
              items={[
                ...(attemptsForContact == null
                  ? [
                      {
                        label: "Attempts per Contact",
                        reason: "Not available for this contact in session state — coming soon.",
                      },
                    ]
                  : []),
                {
                  label: "Connect Rate",
                  reason: "Needs session aggregates — use Dashboard. Coming soon here.",
                },
                {
                  label: "Session Goal Progress",
                  reason: "No goal-setting in app yet — coming soon.",
                },
              ]}
            />
            <p style={{ marginTop: 16 }}>
              <Link className="ghost-btn btn-32" to="/dashboard">
                View full Dashboard →
              </Link>
            </p>
          </section>
        ) : null}
      </div>
    </aside>
  );
}
