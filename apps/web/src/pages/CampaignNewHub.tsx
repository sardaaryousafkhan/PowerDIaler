import type { ReactElement } from "react";
import { Link } from "react-router-dom";

export function CampaignNewHub(): ReactElement {
  return (
    <div className="detail-stack">
      <p className="back-row">
        <Link className="text-link" to="/campaigns">
          ← Back
        </Link>
      </p>

      <header className="page-hero">
        <h1 className="page-hero__title">New campaign</h1>
        <p className="page-hero__lede">
          Choose voice or SMS. Voice can import contacts later; SMS requires a list on create.
        </p>
      </header>

      <div className="campaign-kind-pick" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 12 }}>
        <Link className="campaign-kind-card panel panel-lift" to="/new/dial">
          <span className="micro">Voice</span>
          <h3 className="section-title" style={{ marginTop: 8 }}>Dial campaign</h3>
          <p className="muted subtle">Sequential outbound calls with a script. Optional SMS follow-up.</p>
          <span className="text-link" style={{ marginTop: 12, display: "inline-block" }}>Configure voice</span>
        </Link>
        <Link className="campaign-kind-card panel panel-lift" to="/new/sms">
          <span className="micro">SMS</span>
          <h3 className="section-title" style={{ marginTop: 8 }}>SMS campaign</h3>
          <p className="muted subtle">Text-only path. Consent and DNC rules still apply.</p>
          <span className="text-link" style={{ marginTop: 12, display: "inline-block" }}>Configure SMS</span>
        </Link>
      </div>
    </div>
  );
}
