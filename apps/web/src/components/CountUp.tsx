import { useEffect, useRef, useState, type ReactElement } from "react";
import { prefersReducedMotion } from "../design/motion.js";

/** Tabular count-up over 600ms on mount. */
export function CountUp({
  value,
  className,
  durationMs = 600,
}: {
  value: number;
  className?: string;
  durationMs?: number;
}): ReactElement {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setDisplay(value);
      return;
    }
    const from = fromRef.current;
    const start = performance.now();
    let raf = 0;
    function tick(now: number): void {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (value - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = value;
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);

  return (
    <span className={className} style={{ fontVariantNumeric: "tabular-nums" }}>
      {display.toLocaleString()}
    </span>
  );
}
