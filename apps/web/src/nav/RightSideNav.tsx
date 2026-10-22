import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
} from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../authContext.js";
import { isRbacNavEnabled } from "../featureFlags.js";
import { useNotifier } from "../notifications/context.js";
import {
  friendlyAccessDeniedMessage,
  menuForRole,
  resolveMenuRole,
  type RbacMenuItem,
} from "./rbacMenuConfig.js";

const COMPACT_LS = "pd_rbac_nav_compact";

/**
 * Right-side role-filtered nav (rbacNav). Left AppRail is untouched.
 * Hidden items are not mounted — no CSS hide.
 */
export function RightSideNav(): ReactElement | null {
  const { user, organization, can } = useAuth();
  const { pushToast } = useNotifier();
  const location = useLocation();
  const [compact, setCompact] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(COMPACT_LS) === "1";
  });

  const enabled = isRbacNavEnabled();
  const role = resolveMenuRole(organization?.orgRole, user?.role);
  const sections = useMemo(() => menuForRole(role), [role]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(COMPACT_LS, compact ? "1" : "0");
  }, [compact]);

  if (!enabled || !user) return null;

  function onActivate(item: RbacMenuItem, e: MouseEvent | KeyboardEvent): void {
    if (item.permission && !can(item.permission)) {
      e.preventDefault();
      pushToast({
        variant: "error",
        title: "Access denied",
        message: friendlyAccessDeniedMessage(role),
      });
    }
  }

  function onKeyDownItem(item: RbacMenuItem, e: KeyboardEvent<HTMLAnchorElement>): void {
    if (e.key === "Enter" || e.key === " ") {
      onActivate(item, e);
    }
  }

  return (
    <aside
      className={`rbac-right-nav${compact ? " rbac-right-nav--compact" : ""}`}
      aria-label={`${role} navigation`}
      data-rbac-role={role}
    >
      <div className="rbac-right-nav__head">
        {!compact ? (
          <p className="rbac-right-nav__title" id="rbac-right-nav-title">
            {role === "ORG_OWNER" ? "Owner menu" : role === "ORG_ADMIN" ? "Admin menu" : "My menu"}
          </p>
        ) : (
          <span className="rbac-right-nav__title-compact" aria-hidden>
            {role === "ORG_OWNER" ? "O" : role === "ORG_ADMIN" ? "A" : "U"}
          </span>
        )}
        <button
          type="button"
          className="rbac-right-nav__toggle"
          aria-pressed={compact}
          aria-label={compact ? "Expand navigation" : "Collapse navigation to icons"}
          title={compact ? "Expand" : "Collapse"}
          onClick={() => setCompact((v) => !v)}
        >
          {compact ? "»" : "«"}
        </button>
      </div>
      <nav className="rbac-right-nav__scroll" aria-labelledby={compact ? undefined : "rbac-right-nav-title"}>
        {sections.map((section) => (
          <div key={section.id} className="rbac-right-nav__section" data-order-key={section.orderKey}>
            {!compact ? (
              <p className="rbac-right-nav__section-label">{section.label}</p>
            ) : (
              <p className="rbac-right-nav__section-label rbac-right-nav__section-label--sr" >
                {section.label}
              </p>
            )}
            <ul className="rbac-right-nav__list" role="list">
              {section.items.map((item) => {
                const active =
                  Boolean(item.path) &&
                  (location.pathname === item.path ||
                    (item.path !== "/" && location.pathname.startsWith(`${item.path}/`)));
                const className = `rbac-right-nav__item${active ? " rbac-right-nav__item--active" : ""}`;
                const label = compact ? item.shortLabel : item.label;
                if (item.href) {
                  return (
                    <li key={item.id}>
                      <a
                        className={className}
                        href={item.href}
                        title={item.label}
                        aria-label={item.label}
                        onClick={(e) => onActivate(item, e)}
                        onKeyDown={(e) => onKeyDownItem(item, e)}
                      >
                        <span className="rbac-right-nav__item-text">{label}</span>
                      </a>
                    </li>
                  );
                }
                return (
                  <li key={item.id}>
                    <Link
                      className={className}
                      to={item.path ?? "/dashboard"}
                      title={item.label}
                      aria-label={item.label}
                      aria-current={active ? "page" : undefined}
                      onClick={(e) => onActivate(item, e)}
                      onKeyDown={(e) => onKeyDownItem(item, e)}
                    >
                      <span className="rbac-right-nav__item-text">{label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
