/** Batch 4 flips this to enforce in prod. CI runs tests with it on. */
export function isRbacEnforceAdminPerms(): boolean {
  const raw = String(process.env.RBAC_ENFORCE_ADMIN_PERMS ?? "")
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}
