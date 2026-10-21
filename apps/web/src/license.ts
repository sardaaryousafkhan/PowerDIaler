export type LicenseStatus = {
  ok: boolean;
  reason?: string;
  status?: string;
  graceRemainingMs?: number | null;
  expiresAt?: string | null;
  hasKey?: boolean;
  machineId?: string;
  verifyUrl?: string;
  skipLicense?: boolean;
  error?: string | null;
  offline?: boolean;
};

type DesktopBridge = {
  isDesktop?: boolean;
  getLicenseStatus: () => Promise<LicenseStatus>;
  activateLicense: (key: string) => Promise<LicenseStatus>;
  clearLicense: () => Promise<LicenseStatus>;
  refreshLicense: () => Promise<LicenseStatus>;
  openExternal: (url: string) => Promise<{ ok: boolean }>;
};

declare global {
  interface Window {
    dashdialerDesktop?: DesktopBridge;
  }
}

export function isDesktopShell(): boolean {
  return Boolean(typeof window !== "undefined" && window.dashdialerDesktop?.isDesktop);
}

/** Browser/dev without desktop bridge: treat as unlocked (license enforced in Electron). */
export async function getLicenseStatus(): Promise<LicenseStatus> {
  if (!isDesktopShell() || !window.dashdialerDesktop) {
    return { ok: true, reason: "web_dev", status: "active", skipLicense: true };
  }
  return window.dashdialerDesktop.getLicenseStatus();
}

export async function activateLicense(key: string): Promise<LicenseStatus> {
  if (!isDesktopShell() || !window.dashdialerDesktop) {
    return { ok: false, error: "License activation is only available in the desktop app." };
  }
  return window.dashdialerDesktop.activateLicense(key);
}

export async function refreshLicense(): Promise<LicenseStatus> {
  if (!isDesktopShell() || !window.dashdialerDesktop) {
    return getLicenseStatus();
  }
  return window.dashdialerDesktop.refreshLicense();
}

export function licenseBlocksPaidFeatures(status: LicenseStatus | null): boolean {
  if (!status) return false;
  if (status.skipLicense || status.reason === "web_dev") return false;
  return !status.ok;
}
