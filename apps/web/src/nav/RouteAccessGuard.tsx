import type { FunctionPermissionKey } from "@powerdialer/shared";
import type { ReactElement } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../authContext.js";
import { isRbacNavEnabled } from "../featureFlags.js";
import {
  friendlyAccessDeniedMessage,
  isOwnerOnlyPath,
  resolveMenuRole,
} from "./rbacMenuConfig.js";

function requiredPermissionForPath(pathname: string): FunctionPermissionKey | null {
  if (pathname.startsWith("/org/billing")) return "billing_view";
  if (pathname.startsWith("/org/settings")) return "company_settings";
  if (pathname.startsWith("/integrations")) return "integrations_manage";
  if (pathname.startsWith("/crm")) return "crm_manage";
  return null;
}

/**
 * When rbacNav is on, block Admin/Agent from Owner-only routes with a friendly
 * message (backend still returns 403 on API — this avoids a broken empty page).
 */
export function RouteAccessGuard({ children }: { children: ReactElement }): ReactElement {
  const { user, organization, can } = useAuth();
  const location = useLocation();
  if (!isRbacNavEnabled() || !user) return children;

  const role = resolveMenuRole(organization?.orgRole, user.role);
  if (role === "ORG_OWNER") return children;

  if (!isOwnerOnlyPath(location.pathname)) return children;

  const needed = requiredPermissionForPath(location.pathname);
  if (needed && can(needed)) return children;

  return (
    <div className="layout padded" role="alert" data-testid="rbac-access-denied">
      <h1>Access denied</h1>
      <p className="error">{friendlyAccessDeniedMessage(role)}</p>
    </div>
  );
}
