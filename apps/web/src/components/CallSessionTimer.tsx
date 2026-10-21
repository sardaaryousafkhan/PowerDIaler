import { useEffect, useRef, useState, type ReactElement } from "react";

/**
 * Isolated timer — owns its own 1s state so CampaignDetail does not re-render
 * every tick (was ~entire 1100-line page × 60/min).
 */
export function CallSessionTimer({
  running,
  className = "live-call__timer tabular",
}: {
  running: boolean;
  className?: string;
}): ReactElement {
  const [seconds, setSeconds] = useState(0);
  const renders = useRef(0);
  renders.current += 1;
  if (typeof window !== "undefined") {
    (window as unknown as { __pdTimerRenders?: number }).__pdTimerRenders = renders.current;
  }

  useEffect(() => {
    if (!running) {
      setSeconds(0);
      return;
    }
    setSeconds(0);
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <div className={className} aria-hidden data-timer-renders={renders.current}>
      {mm}:{ss}
    </div>
  );
}
