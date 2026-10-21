/**
 * Lightweight Storybook-style state matrix (no Storybook runtime required).
 * Import in a docs page or open via Vite if stories are wired later.
 */
import type { ReactElement } from "react";
import { Button } from "./Button.js";
import { StatusPill } from "./StatusPill.js";
import { Card } from "./Card.js";

export function PrimitivesGallery(): ReactElement {
  return (
    <div className="detail-stack padded">
      <h1>Primitives</h1>
      <Card>
        <h3 className="section-title">Buttons</h3>
        <div className="row">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
        </div>
      </Card>
      <Card>
        <h3 className="section-title">Status</h3>
        <div className="row">
          <StatusPill label="Live" tone="live" />
          <StatusPill label="Paused" tone="warn" />
          <StatusPill label="Offline" tone="idle" />
          <StatusPill label="Failed" tone="danger" />
        </div>
      </Card>
      <div className="empty-state">
        <h2 className="empty-state__title">Queue is clear.</h2>
        <p className="empty-state__body">Add leads to start dialing.</p>
        <Button variant="ghost">Add leads</Button>
      </div>
    </div>
  );
}
