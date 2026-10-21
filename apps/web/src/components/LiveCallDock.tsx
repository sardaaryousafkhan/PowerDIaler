import type { ReactElement } from "react";
import {
  IconHangup,
  IconHold,
  IconKeypad,
  IconMute,
  IconTransfer,
} from "../icons/index.js";

function DockControl({
  label,
  reason,
  disabled,
  hang,
  on,
  onClick,
  children,
}: {
  label: string;
  reason?: string;
  disabled?: boolean;
  hang?: boolean;
  on?: boolean;
  onClick?: () => void;
  children: ReactElement;
}): ReactElement {
  const aria = reason ? `${label} — ${reason}` : label;
  return (
    <div className={`call-dock__control${disabled ? " call-dock__control--disabled" : ""}`}>
      <button
        type="button"
        className={`call-dock__btn pressable${hang ? " call-dock__btn--hang" : ""}${on ? " call-dock__btn--on" : ""}${
          disabled ? " call-dock__btn--disabled" : ""
        }`}
        aria-label={aria}
        aria-disabled={disabled ? true : undefined}
        title={aria}
        disabled={disabled}
        onClick={disabled ? undefined : onClick}
      >
        {children}
      </button>
      <span className="call-dock__caption" aria-hidden="true">
        {label}
      </span>
      {reason ? (
        <span className="call-dock__reason" aria-hidden="true">
          {reason}
        </span>
      ) : null}
    </div>
  );
}

export function LiveCallDock({
  muted = false,
  onMute,
  onHangup,
  layout = "bar",
  endCallHint,
}: {
  muted?: boolean;
  onMute?: () => void;
  onHangup?: () => void;
  /** bar = bottom dock; stack = Call Control column in right panel */
  layout?: "bar" | "stack";
  /** Optional copy near End Call — only if post-hang-up lands on session controls */
  endCallHint?: string | null;
}): ReactElement {
  return (
    <div
      className={`call-dock${layout === "stack" ? " call-dock--stack" : ""}`}
      role="toolbar"
      aria-label="Call controls"
    >
      <DockControl label={muted ? "Unmute" : "Mute"} on={muted} onClick={onMute}>
        <IconMute />
      </DockControl>
      <DockControl
        label="Hold / Resume"
        reason="Hold and Resume not supported by carrier — coming soon."
        disabled
      >
        <IconHold />
      </DockControl>
      {/* Working single Transfer stays outside any "Coming soon" group (condition 3). */}
      <DockControl label="Transfer" reason="Not available yet" disabled>
        <IconTransfer />
      </DockControl>
      <DockControl label="Keypad (DTMF)" reason="DTMF not available yet." disabled>
        <IconKeypad />
      </DockControl>
      <DockControl label="End Call" hang onClick={onHangup}>
        <IconHangup />
      </DockControl>
      {endCallHint ? (
        <p className="call-dock__hint muted subtle" style={{ margin: layout === "stack" ? "8px 0 0" : 0 }}>
          {endCallHint}
        </p>
      ) : null}
    </div>
  );
}
