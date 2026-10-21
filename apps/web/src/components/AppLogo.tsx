import { useEffect, useState, type ReactElement } from "react";

type Size = "sm" | "md" | "lg" | "xl" | "hero" | "watermark";

const SIZE_PX: Record<Size, number> = {
  sm: 16,
  md: 24,
  lg: 40,
  xl: 96,
  hero: 240,
  watermark: 320,
};

type Props = {
  compact?: boolean;
  /** mark-only for rail collapsed */
  markOnly?: boolean;
  size?: Size;
  /** 800ms stroke draw once per session */
  drawIn?: boolean;
  className?: string;
};

/**
 * Geometric power-arc mark: solid origin + three quarter-arcs.
 * Innermost arc uses --rose-500; rest uses currentColor.
 */
export function AppLogoMark({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}): ReactElement {
  return (
    <svg
      className={`app-logo__mark${className ? ` ${className}` : ""}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="6" cy="18" r="2" fill="currentColor" className="app-logo__origin" />
      <path
        className="app-logo__arc app-logo__arc--outer"
        d="M8 18 A10 10 0 0 1 18 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="square"
      />
      <path
        className="app-logo__arc app-logo__arc--mid"
        d="M8 18 A7 7 0 0 1 15 11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="square"
      />
      <path
        className="app-logo__arc app-logo__arc--inner"
        d="M8 18 A4 4 0 0 1 12 14"
        stroke="var(--rose-500)"
        strokeWidth="1.5"
        strokeLinecap="square"
        pathLength={1}
      />
    </svg>
  );
}

const DRAW_KEY = "pd_logo_drawn";

export function AppLogo(props: Props): ReactElement {
  const sizeKey: Size = props.size ?? (props.compact || props.markOnly ? "md" : "lg");
  const px =
    props.compact && !props.size
      ? 32
      : props.markOnly && !props.size
        ? 32
        : SIZE_PX[sizeKey];
  const [draw, setDraw] = useState(false);

  useEffect(() => {
    if (!props.drawIn) return;
    try {
      if (sessionStorage.getItem(DRAW_KEY) === "1") {
        setDraw(false);
        return;
      }
      sessionStorage.setItem(DRAW_KEY, "1");
    } catch {
      // ignore
    }
    setDraw(true);
  }, [props.drawIn]);

  const classes = [
    "app-logo",
    props.compact ? "app-logo--compact" : "",
    props.markOnly ? "app-logo--mark" : "",
    sizeKey === "lg" || sizeKey === "md" ? "app-logo--header" : "",
    sizeKey === "xl" ? "app-logo--login" : "",
    draw || props.drawIn ? "app-logo--draw" : "",
    props.className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <div className="app-logo__mark-wrap" aria-hidden>
        <AppLogoMark size={px} />
      </div>
      {!props.markOnly && sizeKey !== "watermark" && sizeKey !== "hero" ? (
        <div className="app-logo__type">
          <span className="app-logo__title">DashDialer</span>
        </div>
      ) : null}
    </div>
  );
}
