import type { ReactElement } from "react";
import clsx from "clsx";

type Tone = "live" | "warn" | "danger" | "idle" | "info";

export function StatusPill({
  label,
  tone = "idle",
}: {
  label: string;
  tone?: Tone;
}): ReactElement {
  return (
    <span
      className={clsx(
        "status-pill",
        tone === "live" && "status-pill--live",
        tone === "warn" && "status-pill--warn",
        tone === "danger" && "status-pill--danger",
      )}
    >
      {label}
    </span>
  );
}
