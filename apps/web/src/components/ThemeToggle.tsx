import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { applyThemeMode, readThemeMode, writeThemeMode, type ThemeMode } from "../theme.js";
import { useUserPreferences } from "../userPreferencesContext.js";

const OPTIONS: { id: ThemeMode; label: string; hint: string }[] = [
  { id: "system", label: "System", hint: "Appearance follows the operating system setting." },
  { id: "dark", label: "Dark", hint: "Reduced glare for low-light or extended sessions." },
  { id: "light", label: "Light", hint: "Higher contrast for bright environments or screen sharing." },
];

function modeLabel(m: ThemeMode): string {
  return OPTIONS.find((o) => o.id === m)?.label ?? "System";
}

export function ThemeToggle(): ReactElement {
  const { settings, updateSettings } = useUserPreferences();
  const [mode, setMode] = useState<ThemeMode>(() => {
    try {
      return readThemeMode();
    } catch {
      return "system";
    }
  });
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!settings?.theme) return;
    setMode(settings.theme);
  }, [settings?.theme]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const el = rootRef.current;
      if (el && !el.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Apply immediately and keep in sync with OS changes when on System.
  useEffect(() => {
    applyThemeMode(mode);
    try {
      writeThemeMode(mode);
    } catch {
      // ignore
    }
  }, [mode]);

  useEffect(() => {
    if (mode !== "system") return;
    const mql = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mql) return;

    const onChange = () => applyThemeMode("system");
    // Ensure we re-apply on OS toggle.
    onChange();
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, [mode]);

  const active = useMemo(() => modeLabel(mode), [mode]);

  return (
    <div ref={rootRef} className="theme-toggle" data-open={open ? "1" : "0"}>
      <button
        type="button"
        className="theme-toggle__button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="theme-toggle__text">{active}</span>
      </button>
      {open ? (
        <div className="theme-toggle__menu" role="menu" aria-label="Theme">
          {OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              role="menuitemradio"
              aria-checked={mode === o.id}
              className={`theme-toggle__item ${mode === o.id ? "theme-toggle__item--active" : ""}`}
              onClick={() => {
                setMode(o.id);
                setOpen(false);
                void updateSettings({ theme: o.id }).catch(() => {
                  // preferences sync is best-effort; local theme still applied
                });
              }}
            >
              <span className="theme-toggle__item-label">{o.label}</span>
              <span className="theme-toggle__item-hint">{o.hint}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

