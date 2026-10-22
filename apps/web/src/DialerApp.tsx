import { Suspense, lazy, useEffect, useState, type ReactElement } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { AppLogo } from "./components/AppLogo.js";
import { CommandPalette, HELP_URL } from "./components/CommandPalette.js";
import { LicenseBanner } from "./components/LicenseBanner.js";
import { ThemeToggle } from "./components/ThemeToggle.js";
import { useAuth } from "./authContext.js";
import { LicenseProvider } from "./licenseContext.js";
import { ToastHistoryButton, ToastProvider } from "./notifications/context.js";
import { UserPreferencesProvider } from "./userPreferencesContext.js";
import { spring } from "./design/motion.js";
import {
  IconBilling,
  IconCampaigns,
  IconCrm,
  IconDashboard,
  IconDnc,
  IconHelp,
  IconIntegrations,
  IconLicense,
  IconLogout,
  IconMembers,
  IconPlus,
  IconPortal,
  IconSearch,
  IconSettings,
} from "./icons/index.js";
import { LoginPage } from "./pages/LoginPage.js";
import { RegisterPage } from "./pages/RegisterPage.js";
import { LicenseActivatePage } from "./pages/LicenseActivatePage.js";
import { ApiForbiddenListener } from "./nav/ApiForbiddenListener.js";
import { RightSideNav } from "./nav/RightSideNav.js";
import { RouteAccessGuard } from "./nav/RouteAccessGuard.js";

/** Lazy primary routes — shrink main chunk (was ~780KB with eager Dashboard/List) */
const DashboardPage = lazy(() =>
  import("./pages/DashboardPage.js").then((m) => ({ default: m.DashboardPage })),
);
const CampaignList = lazy(() =>
  import("./pages/CampaignList.js").then((m) => ({ default: m.CampaignList })),
);
const DashboardSettingsPage = lazy(() =>
  import("./pages/DashboardSettingsPage.js").then((m) => ({ default: m.DashboardSettingsPage })),
);
const CampaignDetail = lazy(() =>
  import("./pages/CampaignDetail.js").then((m) => ({ default: m.CampaignDetail })),
);
const CampaignNewHub = lazy(() =>
  import("./pages/CampaignNewHub.js").then((m) => ({ default: m.CampaignNewHub })),
);
const CampaignNew = lazy(() =>
  import("./pages/CampaignNew.js").then((m) => ({ default: m.CampaignNew })),
);
const IntegrationsPage = lazy(() =>
  import("./pages/IntegrationsPage.js").then((m) => ({ default: m.IntegrationsPage })),
);
const DncPage = lazy(() => import("./pages/DncPage.js").then((m) => ({ default: m.DncPage })));
const CrmPage = lazy(() => import("./pages/CrmPage.js").then((m) => ({ default: m.CrmPage })));
const UserPortalPage = lazy(() =>
  import("./pages/UserPortalPage.js").then((m) => ({ default: m.UserPortalPage })),
);
const AdminPortalPage = lazy(() =>
  import("./pages/AdminPortalPage.js").then((m) => ({ default: m.AdminPortalPage })),
);
const OrgSettingsPage = lazy(() =>
  import("./pages/OrgSettingsPage.js").then((m) => ({ default: m.OrgSettingsPage })),
);
const OrgBillingPage = lazy(() =>
  import("./pages/OrgBillingPage.js").then((m) => ({ default: m.OrgBillingPage })),
);
const AcceptInvitePage = lazy(() =>
  import("./pages/AcceptInvitePage.js").then((m) => ({ default: m.AcceptInvitePage })),
);

/** Prefetch lazy chunks after 200ms rail hover dwell */
const ROUTE_PREFETCH: Record<string, () => Promise<unknown>> = {
  "/dashboard": () => import("./pages/DashboardPage.js"),
  "/campaigns": () => import("./pages/CampaignList.js"),
  "/new": () => import("./pages/CampaignNewHub.js"),
  "/integrations": () => import("./pages/IntegrationsPage.js"),
  "/crm": () => import("./pages/CrmPage.js"),
  "/dnc": () => import("./pages/DncPage.js"),
  "/org/settings": () => import("./pages/OrgSettingsPage.js"),
  "/org/billing": () => import("./pages/OrgBillingPage.js"),
  "/portal/user": () => import("./pages/UserPortalPage.js"),
  "/portal/admin": () => import("./pages/AdminPortalPage.js"),
};

function PageFallback(): ReactElement {
  return (
    <div className="route-shell-skeleton" aria-busy="true">
      <div className="shimmer-line wide" />
      <div className="shimmer-line" />
      <div className="shimmer-line narrow" />
    </div>
  );
}

function RequireAuth({ children }: { children: ReactElement }): ReactElement {
  const { user, loading, signingIn } = useAuth();
  const location = useLocation();
  if (loading) return <div className="layout padded muted">Loading session…</div>;
  if (!user && signingIn) return <PageFallback />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return children;
}

function PublicOnly({ children }: { children: ReactElement }): ReactElement {
  const { user, loading } = useAuth();
  if (loading) return <div className="layout padded muted">Loading session…</div>;
  if (user) return <Navigate to="/dashboard" replace />;
  return children;
}

function RailLink({
  to,
  end,
  icon,
  label,
  onNavigate,
}: {
  to: string;
  end?: boolean;
  icon: ReactElement;
  label: string;
  onNavigate: () => void;
}): ReactElement {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      data-prefetch={ROUTE_PREFETCH[to] ? to : undefined}
      className={({ isActive }) => `rail-item${isActive ? " rail-item--active" : ""}`}
    >
      {({ isActive }) => (
        <>
          {isActive ? (
            <motion.span
              className="rail-indicator"
              layoutId="rail-indicator"
              transition={spring.physical}
            />
          ) : null}
          <span className="rail-item__icon">{icon}</span>
          <span className="rail-item__text">{label}</span>
        </>
      )}
    </NavLink>
  );
}

function AppRail({
  mobileOpen,
  closeMobile,
}: {
  mobileOpen: boolean;
  closeMobile: () => void;
}): ReactElement {
  const { user, organization, can, logout } = useAuth();
  const authed = Boolean(user);

  async function onLogout(): Promise<void> {
    await logout();
    closeMobile();
  }

  return (
    <>
      <div
        className={`sidebar-backdrop${mobileOpen ? " sidebar-backdrop--open" : ""}`}
        onClick={closeMobile}
      />
      <aside
        id="pd-sidebar"
        className={`app-rail${mobileOpen ? " app-rail--open" : ""}`}
      >
        <Link
          className="app-rail__brand"
          to={authed ? "/dashboard" : "/login"}
          onClick={closeMobile}
        >
          <AppLogo compact size="lg" />
        </Link>
        <nav className="app-rail__nav" aria-label="Primary">
          {authed ? (
            <>
              <p className="app-rail__label">Workspace</p>
              <RailLink to="/dashboard" icon={<IconDashboard />} label="Dashboard" onNavigate={closeMobile} />
              <RailLink to="/campaigns" icon={<IconCampaigns />} label="Campaigns" onNavigate={closeMobile} />
              {can("campaign_create") ? (
                <RailLink to="/new" icon={<IconPlus />} label="New campaign" onNavigate={closeMobile} />
              ) : null}
              {can("integrations_manage") ? (
                <RailLink
                  to="/integrations"
                  icon={<IconIntegrations />}
                  label="Integrations"
                  onNavigate={closeMobile}
                />
              ) : null}
              {can("crm_manage") ? (
                <RailLink to="/crm" icon={<IconCrm />} label="CRM" onNavigate={closeMobile} />
              ) : null}
              {can("dnc_manage") ? (
                <RailLink to="/dnc" icon={<IconDnc />} label="DNC" onNavigate={closeMobile} />
              ) : null}
              <p className="app-rail__label">Company</p>
              {can("company_settings") ? (
                <RailLink
                  to="/org/settings"
                  icon={<IconSettings />}
                  label="Org settings"
                  onNavigate={closeMobile}
                />
              ) : null}
              {can("members_manage") ? (
                <RailLink
                  to="/portal/admin"
                  icon={<IconMembers />}
                  label="Members"
                  onNavigate={closeMobile}
                />
              ) : null}
              {can("billing_view") ? (
                <RailLink to="/org/billing" icon={<IconBilling />} label="Billing" onNavigate={closeMobile} />
              ) : null}
              <RailLink to="/license" icon={<IconLicense />} label="License" onNavigate={closeMobile} />
              <RailLink to="/portal/user" icon={<IconPortal />} label="User portal" onNavigate={closeMobile} />
            </>
          ) : (
            <>
              <p className="app-rail__label">Access</p>
              <RailLink to="/login" icon={<IconPortal />} label="Sign in" onNavigate={closeMobile} />
              <RailLink to="/register" icon={<IconPlus />} label="Register" onNavigate={closeMobile} />
            </>
          )}
        </nav>
        <div className="app-rail__footer">
          {authed ? (
            <button className="ghost-btn btn-32" type="button" onClick={() => void onLogout()}>
              <IconLogout size={16} />
              <span className="rail-item__text">Sign out</span>
            </button>
          ) : null}
          {authed ? (
            <span className="muted subtle caption" style={{ padding: "0 8px" }}>
              {organization?.name ? `${organization.name}` : user?.email}
            </span>
          ) : null}
        </div>
      </aside>
    </>
  );
}

function AuthedRoutes(): ReactElement {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/dashboard/settings" element={<DashboardSettingsPage />} />
        <Route path="/dashboard/settings/:section" element={<Navigate to="/dashboard/settings" replace />} />
        <Route path="/campaigns" element={<CampaignList />} />
        <Route path="/campaigns/:id" element={<CampaignDetail />} />
        <Route path="/new" element={<CampaignNewHub />} />
        <Route path="/new/dial" element={<CampaignNew kind="DIAL" />} />
        <Route path="/new/sms" element={<CampaignNew kind="SMS" />} />
        <Route path="/integrations" element={<IntegrationsPage />} />
        <Route path="/crm" element={<CrmPage />} />
        <Route path="/dnc" element={<DncPage />} />
        <Route path="/portal/user" element={<UserPortalPage />} />
        <Route path="/portal/admin" element={<AdminPortalPage />} />
        <Route path="/org/settings" element={<OrgSettingsPage />} />
        <Route path="/org/billing" element={<OrgBillingPage />} />
        <Route path="/license" element={<LicenseActivatePage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}

function PublicRoutes(): ReactElement {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
        <Route path="/register" element={<PublicOnly><RegisterPage /></PublicOnly>} />
        <Route path="/accept-invite" element={<AcceptInvitePage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Suspense>
  );
}

function RoutedContent(): ReactElement {
  const { user, loading, signingIn } = useAuth();
  if (loading) return <div className="layout padded muted">Loading session…</div>;
  return user || signingIn ? (
    <RequireAuth>
      <AuthedRoutes />
    </RequireAuth>
  ) : (
    <PublicRoutes />
  );
}

export function DialerApp(): ReactElement {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const location = useLocation();
  const isPublicAuthRoute = location.pathname === "/login" || location.pathname === "/register";

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** Press feedback on pointerdown (<100ms) — not wait for click/mouseup */
  useEffect(() => {
    function down(e: PointerEvent): void {
      const t = (e.target as HTMLElement | null)?.closest?.(
        ".primary, .pressable, .dashboard-action--primary, .call-dock__btn, .ghost-btn",
      ) as HTMLElement | null;
      if (!t) return;
      t.dataset.pressed = "true";
    }
    function up(): void {
      document.querySelectorAll("[data-pressed='true']").forEach((el) => {
        delete (el as HTMLElement).dataset.pressed;
      });
    }
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
    };
  }, []);

  /** Document-level rail prefetch (200ms dwell) — reliable vs React synthetic hover */
  useEffect(() => {
    let timer: number | null = null;
    let lastHref: string | null = null;
    function clear(): void {
      if (timer) window.clearTimeout(timer);
      timer = null;
      lastHref = null;
    }
    function over(e: PointerEvent): void {
      const a = (e.target as HTMLElement | null)?.closest?.("a.rail-item[data-prefetch]") as
        | HTMLAnchorElement
        | null;
      if (!a) return;
      const href = a.getAttribute("data-prefetch");
      if (!href || !ROUTE_PREFETCH[href]) return;
      if (lastHref === href) return;
      clear();
      lastHref = href;
      timer = window.setTimeout(() => {
        const load = ROUTE_PREFETCH[href];
        if (!load) return;
        const t = performance.now();
        void load()
          .then(() => {
            const w = window as unknown as { __prefetchLog?: string[] };
            w.__prefetchLog = [...(w.__prefetchLog ?? []), `${href}@${Math.round(t)}`];
          })
          .catch(() => undefined);
      }, 200);
    }
    function leave(e: PointerEvent): void {
      const a = (e.target as HTMLElement | null)?.closest?.("a.rail-item[data-prefetch]");
      if (a) clear();
    }
    document.addEventListener("pointerover", over, true);
    document.addEventListener("pointerout", leave, true);
    return () => {
      clear();
      document.removeEventListener("pointerover", over, true);
      document.removeEventListener("pointerout", leave, true);
    };
  }, []);

  return (
    <UserPreferencesProvider>
      <LicenseProvider>
        <ToastProvider>
          <div className="app-noise" aria-hidden />
          <div className="app-seam" aria-hidden />
          <div className="layout">
            {!isPublicAuthRoute ? (
              <button
                className="mobile-nav-toggle"
                type="button"
                onClick={() => setMobileOpen((v) => !v)}
                aria-expanded={mobileOpen}
                aria-controls="pd-sidebar"
              >
                <span className="mobile-nav-toggle__bars" aria-hidden>
                  <span />
                  <span />
                  <span />
                </span>
                Menu
              </button>
            ) : null}
            <div
              className={`workspace-shell${isPublicAuthRoute ? " workspace-shell--public" : ""}${
                mobileOpen ? " workspace-shell--expanded" : ""
              }`}
            >
              {!isPublicAuthRoute ? (
                <AppRail mobileOpen={mobileOpen} closeMobile={() => setMobileOpen(false)} />
              ) : null}
              <div className="workspace-column">
                {!isPublicAuthRoute ? (
                  <header className="command-bar">
                    <button
                      type="button"
                      className="command-bar__search"
                      onClick={() => setCmdOpen(true)}
                    >
                      <IconSearch size={16} />
                      <span>Search or jump…</span>
                      <span className="command-bar__kbd">⌘K</span>
                    </button>
                    <ToastHistoryButton />
                    <ThemeToggle />
                    <a
                      className="command-bar__icon-btn"
                      href={HELP_URL}
                      aria-label="Help"
                      title="Help"
                    >
                      <IconHelp size={16} />
                    </a>
                  </header>
                ) : null}
                <main className="workspace-main" onClick={() => setMobileOpen(false)}>
                  {!isPublicAuthRoute ? <LicenseBanner /> : null}
                  {/* CSS page-enter only — no Framer opacity/y on every route (INP cost) */}
                  <div key={location.pathname} className="route-shell">
                    <RouteAccessGuard>
                      <RoutedContent />
                    </RouteAccessGuard>
                  </div>
                </main>
              </div>
              {!isPublicAuthRoute ? <RightSideNav /> : null}
            </div>
            <ApiForbiddenListener />
            <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
          </div>
        </ToastProvider>
      </LicenseProvider>
    </UserPreferencesProvider>
  );
}
