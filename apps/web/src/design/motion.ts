/** Motion budget — Obsidian & Rosé. Max 2 animated properties; max 480ms. */

export const duration = {
  input: 90,
  hover: 140,
  std: 200,
  overlay: 320,
  deliberate: 480,
} as const;

export const ease = {
  standard: [0.2, 0.8, 0.2, 1] as const,
  enter: [0.16, 1, 0.3, 1] as const,
  exit: [0.4, 0, 1, 1] as const,
};

export const spring = {
  physical: { stiffness: 320, damping: 32, mass: 0.8 },
} as const;

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Framer Motion transition helpers */
export const transitions = {
  input: { duration: duration.input / 1000, ease: ease.standard },
  hover: { duration: duration.hover / 1000, ease: ease.standard },
  std: { duration: duration.std / 1000, ease: ease.standard },
  overlay: { duration: duration.overlay / 1000, ease: ease.enter },
  exit: { duration: duration.std / 1000, ease: ease.exit },
  reduced: { duration: 0.12, ease: "linear" as const },
} as const;
