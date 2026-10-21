export type ThemeMode = "system" | "dark" | "light";

const KEY = "pd_theme_mode";

export function readThemeMode(): ThemeMode {
  const raw = (localStorage.getItem(KEY) ?? "").trim().toLowerCase();
  if (raw === "dark" || raw === "light" || raw === "system") return raw;
  // Product default: Obsidian dark (call-center sessions).
  return "dark";
}

export function writeThemeMode(mode: ThemeMode): void {
  localStorage.setItem(KEY, mode);
}

export function applyThemeMode(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === "system") {
    root.removeAttribute("data-theme");
    return;
  }
  root.setAttribute("data-theme", mode);
}

