import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { api, DEFAULT_USER_WORKSPACE_SETTINGS, type UserWorkspaceSettings } from "./api.js";
import { useAuth } from "./authContext.js";
import { applyThemeMode, readThemeMode, writeThemeMode } from "./theme.js";

export type { UserWorkspaceSettings } from "./api.js";

type Ctx = {
  settings: UserWorkspaceSettings | null;
  loading: boolean;
  refresh: () => Promise<void>;
  updateSettings: (patch: Partial<UserWorkspaceSettings>) => Promise<void>;
};

const UserPreferencesContext = createContext<Ctx | null>(null);
const PREFS_SUPPORT_KEY = "pd_me_preferences_supported";
const PREFS_LOCAL_KEY = "pd_workspace_settings_local";

function isMissingRouteError(error: unknown, route: string, method: "GET" | "PATCH" = "GET"): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.toLowerCase().includes(`route ${method.toLowerCase()}:${route} not found`);
}

function readLocalSettings(): UserWorkspaceSettings {
  try {
    const raw = localStorage.getItem(PREFS_LOCAL_KEY);
    if (!raw) return { ...DEFAULT_USER_WORKSPACE_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<UserWorkspaceSettings>;
    return { ...DEFAULT_USER_WORKSPACE_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_USER_WORKSPACE_SETTINGS };
  }
}

function writeLocalSettings(settings: UserWorkspaceSettings): void {
  try {
    localStorage.setItem(PREFS_LOCAL_KEY, JSON.stringify(settings));
  } catch {
    // ignore localStorage errors
  }
}

function applyWorkspaceToDocument(settings: UserWorkspaceSettings): void {
  applyThemeMode(settings.theme);
  try {
    writeThemeMode(settings.theme);
  } catch {
    // ignore
  }
}

function clearWorkspaceDocumentAttrs(): void {
  const root = document.documentElement;
  // Clear legacy preference attrs from earlier builds.
  root.removeAttribute("data-font");
  root.removeAttribute("data-density");
  root.removeAttribute("data-radius-scale");
  root.removeAttribute("data-chrome");
  root.removeAttribute("data-sidebar");
  root.style.removeProperty("--user-accent");
  try {
    applyThemeMode(readThemeMode());
  } catch {
    applyThemeMode("system");
  }
}

export function UserPreferencesProvider({ children }: { children: ReactNode }): ReactElement {
  const { user } = useAuth();
  const [settings, setSettings] = useState<UserWorkspaceSettings | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      if (sessionStorage.getItem(PREFS_SUPPORT_KEY) === "0") {
        const fallback = readLocalSettings();
        setSettings(fallback);
        applyWorkspaceToDocument(fallback);
        return;
      }
    } catch {
      // ignore storage issues
    }
    setLoading(true);
    try {
      const r = await api.me.preferences.get();
      try {
        sessionStorage.setItem(PREFS_SUPPORT_KEY, "1");
      } catch {
        // ignore storage issues
      }
      writeLocalSettings(r.settings);
      setSettings(r.settings);
      applyWorkspaceToDocument(r.settings);
    } catch (err) {
      if (isMissingRouteError(err, "/me/preferences")) {
        try {
          sessionStorage.setItem(PREFS_SUPPORT_KEY, "0");
        } catch {
          // ignore storage issues
        }
      }
      const fallback = readLocalSettings();
      setSettings(fallback);
      applyWorkspaceToDocument(fallback);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setSettings(null);
      clearWorkspaceDocumentAttrs();
      return;
    }
    void refresh();
  }, [user, refresh]);

  const updateSettings = useCallback(
    async (patch: Partial<UserWorkspaceSettings>) => {
      if (!user) return;
      const knownMissing =
        (() => {
          try {
            return sessionStorage.getItem(PREFS_SUPPORT_KEY) === "0";
          } catch {
            return false;
          }
        })();
      if (knownMissing) {
        const merged = { ...readLocalSettings(), ...patch };
        writeLocalSettings(merged);
        setSettings(merged);
        applyWorkspaceToDocument(merged);
        return;
      }
      try {
        const r = await api.me.preferences.patch({ settings: patch });
        writeLocalSettings(r.settings);
        setSettings(r.settings);
        applyWorkspaceToDocument(r.settings);
      } catch (err) {
        if (isMissingRouteError(err, "/me/preferences", "PATCH")) {
          try {
            sessionStorage.setItem(PREFS_SUPPORT_KEY, "0");
          } catch {
            // ignore storage issues
          }
          const merged = { ...readLocalSettings(), ...patch };
          writeLocalSettings(merged);
          setSettings(merged);
          applyWorkspaceToDocument(merged);
          return;
        }
        throw err;
      }
    },
    [user],
  );

  const value = useMemo<Ctx>(
    () => ({
      settings,
      loading,
      refresh,
      updateSettings,
    }),
    [settings, loading, refresh, updateSettings],
  );

  return <UserPreferencesContext.Provider value={value}>{children}</UserPreferencesContext.Provider>;
}

export function useUserPreferences(): Ctx {
  const ctx = useContext(UserPreferencesContext);
  if (!ctx) throw new Error("useUserPreferences must be used within UserPreferencesProvider");
  return ctx;
}
