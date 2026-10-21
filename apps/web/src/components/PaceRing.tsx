import { useEffect, useState, type ReactElement } from "react";
import { prefersReducedMotion } from "../design/motion.js";

const R = 70;
const C = 2 * Math.PI * R;

/** 160px pace ring — rose arc draws 0→value over 600ms with head dot. */
export function PaceRing({
  value,
  max = 100,
}: {
  value: number;
  max?: number;
}): ReactElement {
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setProgress(pct);
      return;
    }
    setProgress(0);
    const t = window.setTimeout(() => setProgress(pct), 40);
    return () => window.clearTimeout(t);
  }, [pct]);

  const offset = C * (1 - progress);
  const angle = -Math.PI / 2 + progress * 2 * Math.PI;
  const hx = 80 + R * Math.cos(angle);
  const hy = 80 + R * Math.sin(angle);

  return (
    <svg className="pace-ring" viewBox="0 0 160 160" aria-hidden>
      <circle className="pace-ring__track" cx="80" cy="80" r={R} />
      <circle
        className="pace-ring__arc"
        cx="80"
        cy="80"
        r={R}
        strokeDasharray={`${C}`}
        strokeDashoffset={offset}
      />
      {progress > 0.02 ? <circle className="pace-ring__head" cx={hx} cy={hy} r="2" /> : null}
    </svg>
  );
}
