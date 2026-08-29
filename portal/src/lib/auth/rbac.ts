import type { TenantContext, Role } from "@/lib/tenant";

const ROLE_RANK: Record<Role, number> = {
  report_viewer: 1, billing_admin: 2, scan_operator: 3,
  asset_manager: 4, security_admin: 5, organization_owner: 6,
};

export function hasRole(user: TenantContext, ...roles: Role[]): boolean {
  return roles.includes(user.role);
}

export function can(user: TenantContext, action: string, resource: { status?: string }): boolean {
  // In dev/test the compliance gate is relaxed.
  if (user.appMode !== "prod") return true;
  if (user.isStaff) return true;
  if (action === "scope.attest") return hasRole(user, "organization_owner", "security_admin") && resource.status === "submitted";
  if (action === "scope.approve") return hasRole(user, "organization_owner", "security_admin");
  if (action === "asset.manage") return hasRole(user, "organization_owner", "security_admin", "asset_manager");
  if (action === "scan.run") return hasRole(user, "organization_owner", "security_admin", "scan_operator");
  if (action === "report.view") return hasRole(user, "organization_owner", "security_admin", "report_viewer");
  return false;
}

export function requireRole(user: TenantContext, ...roles: Role[]): void {
  if (!hasRole(user, ...roles)) throw new Error("Forbidden");
}
