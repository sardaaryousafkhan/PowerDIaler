import { useMemo, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import type { OrgRolePublic } from "@powerdialer/shared";
import { useAuth } from "../authContext.js";
import { isRbacNavEnabled } from "../featureFlags.js";
import { menuForRole, type RbacMenuItem } from "./rbacMenuConfig.js";

function resolveRole(orgRole: string | undefined | null, legacyRole: string | undefined): OrgRolePublic {
  if (orgRole === "ORG_OWNER" || orgRole === "ORG_ADMIN" || orgRole === "AGENT") return orgRole;
  if (legacyRole === "owner") return "ORG_OWNER";
  if (legacyRole === "admin") return "ORG_ADMIN";
  return "AGENT";
}

/**
 * Right-side role menu. Items not allowed for the role are not mounted (no CSS hide).
 * UI gating is not enforcement — every action still hits the API permission matrix.
 */
export function RoleFilteredMenu(): ReactElement | null {
  const { user, organization, can } = useAuth();
  const [open, setOpen] = useState(false);
  const [deniedMsg, setDeniedMsg] = useState<string | null>(null);

  const enabled = isRbacNavEnabled();
  const role = resolveRole(organization?.orgRole, user?.role);
  const sections = useMemo(() => menuForRole(role), [role]);

  if (!enabled || !user) return null;

  function onItemActivate(item: RbacMenuItem): void {
    setDeniedMsg(null);
    if (item.permission && !can(item.permission)) {
      setDeniedMsg("You don't have access to that. Ask your Owner if you need it.");
      return;
    }
    setOpen(false);
  }

  return (
    <div className="rbac-menu">
      <button
        type="button"
        className="command-bar__icon-btn"
        aria-expanded={open}
        aria-controls="rbac-role-menu"
        aria-label="Account menu"
        onClick={() => setOpen((v) => !v)}
      >
        ☰
      </button>
      {open ? (
        <div id="rbac-role-menu" className="rbac-menu__panel" role="menu" aria-label={`${role} menu`}>
          {deniedMsg ? (
            <p className="rbac-menu__denied" role="status">
              {deniedMsg}
            </p>
          ) : null}
          {sections.map((section) => (
            <div key={section.id} className="rbac-menu__section">
              <p className="rbac-menu__section-label">{section.label}</p>
              <ul className="rbac-menu__list">
                {section.items.map((item) => (
                  <li key={item.id}>
                    {item.href ? (
                      <a
                        className="rbac-menu__item"
                        href={item.href}
                        role="menuitem"
                        onClick={() => onItemActivate(item)}
                      >
                        {item.label}
                      </a>
                    ) : (
                      <Link
                        className="rbac-menu__item"
                        to={item.path ?? "/dashboard"}
                        role="menuitem"
                        onClick={() => onItemActivate(item)}
                      >
                        {item.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
