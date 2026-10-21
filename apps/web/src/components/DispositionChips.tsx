import type { ReactElement } from "react";

/** Single mount for disposition chips — relocate this instance; never render twice. */
export const DISPOSITION_CHIP_OPTIONS = ["Interested", "Callback", "Not now", "DNC"] as const;

export function DispositionChips({
  outcome,
  onSelect,
}: {
  outcome: string | null;
  onSelect: (d: string) => void;
}): ReactElement {
  return (
    <div className="disposition-row" data-disposition-mount="single">
      {DISPOSITION_CHIP_OPTIONS.map((d) => (
        <button
          key={d}
          type="button"
          className={`disposition-chip pressable${outcome === d ? " disposition-chip--on" : ""}`}
          data-outcome={d}
          data-selected={outcome === d ? "true" : "false"}
          onClick={() => {
            // Optimistic: fill chip instantly; toast only on failure if API wired later
            onSelect(d);
          }}
        >
          {d}
        </button>
      ))}
    </div>
  );
}
