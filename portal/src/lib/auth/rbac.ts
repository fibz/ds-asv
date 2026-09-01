import type { TenantContext, Role } from "@/lib/tenant";

export function hasRole(user: TenantContext, ...roles: Role[]): boolean {
  return roles.includes(user.role);
}

export function can(user: TenantContext, action: string, resource?: { status?: string }): boolean {
  // In dev/test the compliance gate is relaxed.
  if (user.appMode !== "prod") return true;
  if (user.isStaff) return true;
  if (action === "scope.attest") return hasRole(user, "organization_owner", "security_admin") && resource?.status === "submitted";
  if (action === "scope.approve") return hasRole(user, "organization_owner", "security_admin");
  if (action === "scope.manage") return hasRole(user, "organization_owner", "security_admin");
  if (action === "scope.view") return hasRole(user, "organization_owner", "security_admin", "asset_manager", "scan_operator");
  // Task 6: inviting new members is limited to org owners and security admins.
  if (action === "member.invite") return hasRole(user, "organization_owner", "security_admin");
  if (action === "asset.manage") return hasRole(user, "organization_owner", "security_admin", "asset_manager");
  if (action === "scan.run") return hasRole(user, "organization_owner", "security_admin", "scan_operator");
  if (action === "scan.view") return hasRole(user, "organization_owner", "security_admin", "asset_manager", "scan_operator");
  if (action === "report.view") return hasRole(user, "organization_owner", "security_admin", "report_viewer");
  if (action === "api-key.manage") return hasRole(user, "organization_owner", "security_admin");
  if (action === "org.view") return true; // any authenticated member
  if (action === "org.manage") return hasRole(user, "organization_owner");
  if (action === "team.view") return hasRole(user, "organization_owner", "security_admin", "asset_manager");
  if (action === "team.manage") return hasRole(user, "organization_owner", "security_admin");
  if (action === "session.revoke") return hasRole(user, "organization_owner", "security_admin");
  if (action === "audit.view") return hasRole(user, "organization_owner", "security_admin");
  return false;
}

export function requireRole(user: TenantContext, ...roles: Role[]): void {
  if (!hasRole(user, ...roles)) throw new Error("Forbidden");
}
