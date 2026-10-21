import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import {
  api,
  DEFAULT_USER_FUNCTION_ACCESS,
  type AuthOrganization,
  type UserFunctionAccess,
} from "./api.js";
import { clearAuthToken, readAuthToken, writeAuthToken } from "./authStore.js";
import type { FunctionPermissionKey } from "@powerdialer/shared";

type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: "user" | "admin" | "owner";
};

type AuthContextValue = {
  user: AuthUser | null;
  organization: AuthOrganization | null;
  permissions: UserFunctionAccess;
  loading: boolean;
  /** True while email/password login is in flight — allows dashboard shell before token lands */
  signingIn: boolean;
  can: (permission: FunctionPermissionKey) => boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    name: string;
    email: string;
    password: string;
    adminCode?: string;
    companyName?: string;
  }) => Promise<void>;
  registerCompany: (input: {
    name: string;
    email: string;
    password: string;
    companyName: string;
  }) => Promise<void>;
  acceptInvite: (input: { token: string; name?: string; password?: string }) => Promise<void>;
  logout: () => Promise<void>;
  applySession: (token: string) => Promise<void>;
  /** Re-fetch /auth/me into local state (e.g. after profile name change). */
  refreshSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [organization, setOrganization] = useState<AuthOrganization | null>(null);
  const [permissions, setPermissions] = useState<UserFunctionAccess>(DEFAULT_USER_FUNCTION_ACCESS);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const signingInRef = useRef(false);

  async function hydrateFromMe() {
    const r = await api.auth.me();
    setUser(r.user);
    setOrganization(r.organization ?? null);
    setPermissions(r.permissions ?? DEFAULT_USER_FUNCTION_ACCESS);
  }

  useEffect(() => {
    const token = readAuthToken();
    if (!token) {
      setLoading(false);
      return;
    }
    void hydrateFromMe()
      .catch(() => {
        clearAuthToken();
        setUser(null);
        setOrganization(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      organization,
      permissions,
      loading,
      signingIn,
      can(permission) {
        if (user?.role === "admin" || user?.role === "owner") return true;
        if (organization?.orgRole === "ORG_OWNER" || organization?.orgRole === "ORG_ADMIN") return true;
        return Boolean(permissions[permission]);
      },
      async login(email, password) {
        signingInRef.current = true;
        flushSync(() => setSigningIn(true));
        try {
          const r = await api.auth.login(email, password);
          writeAuthToken(r.token!);
          setUser(r.user);
          setOrganization(r.organization ?? null);
          setPermissions(r.permissions ?? DEFAULT_USER_FUNCTION_ACCESS);
        } finally {
          signingInRef.current = false;
          setSigningIn(false);
        }
      },
      async register(input) {
        if (input.companyName?.trim()) {
          const r = await api.auth.registerCompany({
            name: input.name,
            email: input.email,
            password: input.password,
            companyName: input.companyName,
          });
          writeAuthToken(r.token!);
          setUser(r.user);
          setOrganization(r.organization ?? null);
          setPermissions(r.permissions ?? DEFAULT_USER_FUNCTION_ACCESS);
          return;
        }
        const r = await api.auth.register(input);
        writeAuthToken(r.token!);
        setUser(r.user);
        setOrganization(r.organization ?? null);
        setPermissions(r.permissions ?? DEFAULT_USER_FUNCTION_ACCESS);
      },
      async registerCompany(input) {
        const r = await api.auth.registerCompany(input);
        writeAuthToken(r.token!);
        setUser(r.user);
        setOrganization(r.organization ?? null);
        setPermissions(r.permissions ?? DEFAULT_USER_FUNCTION_ACCESS);
      },
      async acceptInvite(input) {
        const r = await api.auth.acceptInvite(input);
        writeAuthToken(r.token!);
        setUser(r.user);
        setOrganization(r.organization ?? null);
        setPermissions(r.permissions ?? DEFAULT_USER_FUNCTION_ACCESS);
      },
      async applySession(token) {
        writeAuthToken(token);
        await hydrateFromMe();
      },
      async refreshSession() {
        await hydrateFromMe();
      },
      async logout() {
        try {
          await api.auth.logout();
        } finally {
          clearAuthToken();
          setUser(null);
          setOrganization(null);
          setPermissions(DEFAULT_USER_FUNCTION_ACCESS);
        }
      },
    }),
    [user, organization, permissions, loading, signingIn],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
