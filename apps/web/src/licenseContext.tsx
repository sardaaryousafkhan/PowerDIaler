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
import {
  activateLicense as activateLicenseApi,
  getLicenseStatus,
  isDesktopShell,
  licenseBlocksPaidFeatures,
  refreshLicense as refreshLicenseApi,
  type LicenseStatus,
} from "./license.js";

type LicenseContextValue = {
  status: LicenseStatus | null;
  loading: boolean;
  isDesktop: boolean;
  blocksPaid: boolean;
  refresh: () => Promise<LicenseStatus>;
  activate: (key: string) => Promise<LicenseStatus>;
};

const LicenseContext = createContext<LicenseContextValue | null>(null);

export function LicenseProvider({ children }: { children: ReactNode }): ReactElement {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const isDesktop = isDesktopShell();

  const refresh = useCallback(async () => {
    const next = await refreshLicenseApi();
    setStatus(next);
    setLoading(false);
    return next;
  }, []);

  const activate = useCallback(async (key: string) => {
    const next = await activateLicenseApi(key);
    setStatus(next);
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getLicenseStatus();
        if (!cancelled) setStatus(s);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    const id = window.setInterval(() => {
      void refresh();
    }, 4 * 60 * 60 * 1000);
    const onRequired = () => {
      void refresh();
    };
    window.addEventListener("dashdialer:license-required", onRequired);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener("dashdialer:license-required", onRequired);
    };
  }, [refresh]);

  const value = useMemo<LicenseContextValue>(
    () => ({
      status,
      loading,
      isDesktop,
      blocksPaid: licenseBlocksPaidFeatures(status),
      refresh,
      activate,
    }),
    [status, loading, isDesktop, refresh, activate],
  );

  return <LicenseContext.Provider value={value}>{children}</LicenseContext.Provider>;
}

export function useLicense(): LicenseContextValue {
  const ctx = useContext(LicenseContext);
  if (!ctx) {
    return {
      status: { ok: true, skipLicense: true, reason: "web_dev" },
      loading: false,
      isDesktop: false,
      blocksPaid: false,
      refresh: async () => ({ ok: true, skipLicense: true }),
      activate: async () => ({ ok: false, error: "No license provider" }),
    };
  }
  return ctx;
}
