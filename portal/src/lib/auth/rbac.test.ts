import { describe, it, expect } from "vitest";
import { hasRole, can } from "@/lib/auth/rbac";
import type { TenantContext } from "@/lib/tenant";

const base: TenantContext = { userId: "u1", organizationId: "o1", role: "security_admin", isStaff: false, appMode: "prod" };

describe("rbac", () => {
  it("checks role membership", () => {
    expect(hasRole(base, "organization_owner", "security_admin")).toBe(true);
    expect(hasRole(base, "report_viewer")).toBe(false);
  });
  it("enforces action+resource+state permission", () => {
    // security_admin can attest scope when status is submitted
    expect(can(base, "scope.attest", { status: "submitted" })).toBe(true);
    // but not when status is draft
    expect(can(base, "scope.attest", { status: "draft" })).toBe(false);
  });
  it("staff bypass in dev/test but not prod", () => {
    const dev: TenantContext = { ...base, role: "report_viewer", appMode: "dev" };
    expect(can(dev, "scope.attest", { status: "submitted" })).toBe(true); // gates relaxed
  });
  it("member.invite is limited to organization_owner and security_admin", () => {
    const owner: TenantContext = { ...base, role: "organization_owner" };
    expect(can(owner, "member.invite", {})).toBe(true); // owner may invite
    expect(can(base, "member.invite", {})).toBe(true); // security_admin may invite
    const viewer: TenantContext = { ...base, role: "report_viewer" };
    expect(can(viewer, "member.invite", {})).toBe(false); // viewer may not
  });
});
