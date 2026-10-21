import { useEffect, useRef, type ReactElement } from "react";
import { prefersReducedMotion } from "../design/motion.js";

const BARS = 40;

/**
 * Canvas waveform — draws without React state (no re-render storm).
 * Idle breath ±3%; active noise when `active`.
 */
export function LiveWaveform({ active = true }: { active?: boolean }): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const heightsRef = useRef<Float32Array>(new Float32Array(BARS).fill(0.12));
  const phaseRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = 280;
    const cssH = 56;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (prefersReducedMotion() || !active) {
      ctx.clearRect(0, 0, cssW, cssH);
      const gap = 2;
      const barW = (cssW - gap * (BARS - 1)) / BARS;
      ctx.fillStyle = "color-mix(in srgb, var(--live) 80%, transparent)";
      // fallback solid if color-mix unsupported in canvas
      ctx.fillStyle = "rgba(95, 227, 161, 0.75)";
      for (let i = 0; i < BARS; i++) {
        const h = Math.max(4, 0.12 * cssH);
        ctx.fillRect(i * (barW + gap), cssH - h, barW, h);
      }
      return;
    }

    let last = 0;
    const tick = (now: number): void => {
      // Cap ~11fps draw (~90ms) — enough for breath, cheap on main thread
      if (now - last >= 90) {
        last = now;
        phaseRef.current += 0.18;
        const breath = 0.03 * Math.sin(phaseRef.current);
        const h = heightsRef.current;
        for (let i = 0; i < BARS; i++) {
          const wave = 0.08 + 0.5 * Math.abs(Math.sin(phaseRef.current + i * 0.35));
          const noise = Math.random() * 0.12;
          h[i] = Math.min(1, Math.max(0.04, wave * 0.85 + noise + breath));
        }

        ctx.clearRect(0, 0, cssW, cssH);
        const gap = 2;
        const barW = (cssW - gap * (BARS - 1)) / BARS;
        ctx.fillStyle = "rgba(95, 227, 161, 0.8)";
        for (let i = 0; i < BARS; i++) {
          const bh = Math.max(4, h[i]! * (cssH - 4));
          ctx.fillRect(i * (barW + gap), cssH - bh, Math.max(2, barW), bh);
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [active]);

  return (
    <canvas
      ref={canvasRef}
      className="live-call__waveform live-call__waveform--canvas"
      aria-hidden
    />
  );
}
