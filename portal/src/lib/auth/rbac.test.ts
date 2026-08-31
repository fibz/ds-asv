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
  it("api-key.manage requires owner or security_admin in prod", () => {
    const owner = { ...base, role: "organization_owner" as const };
    const sec = { ...base, role: "security_admin" as const };
    const viewer = { ...base, role: "report_viewer" as const };
    expect(can(owner, "api-key.manage")).toBe(true);
    expect(can(sec, "api-key.manage")).toBe(true);
    expect(can(viewer, "api-key.manage")).toBe(false);
  });
});

describe("user center actions", () => {
  const owner: TenantContext = { userId: "u1", organizationId: "o1", role: "organization_owner", isStaff: false, appMode: "prod" };
  const sec: TenantContext = { userId: "u2", organizationId: "o1", role: "security_admin", isStaff: false, appMode: "prod" };
  const mgr: TenantContext = { userId: "u3", organizationId: "o1", role: "asset_manager", isStaff: false, appMode: "prod" };
  const viewer: TenantContext = { userId: "u4", organizationId: "o1", role: "report_viewer", isStaff: false, appMode: "prod" };

  it("org.view is open to any member, org.manage to owners only", () => {
    for (const u of [owner, sec, mgr, viewer]) expect(can(u, "org.view")).toBe(true);
    expect(can(owner, "org.manage")).toBe(true);
    for (const u of [sec, mgr, viewer]) expect(can(u, "org.manage")).toBe(false);
  });

  it("team.view excludes viewers; team.manage is owner/security_admin", () => {
    for (const u of [owner, sec, mgr]) expect(can(u, "team.view")).toBe(true);
    expect(can(viewer, "team.view")).toBe(false);
    expect(can(owner, "team.manage")).toBe(true);
    expect(can(sec, "team.manage")).toBe(true);
    expect(can(mgr, "team.manage")).toBe(false);
    expect(can(viewer, "team.manage")).toBe(false);
  });

  it("session.revoke and audit.view are owner/security_admin", () => {
    expect(can(owner, "session.revoke")).toBe(true);
    expect(can(sec, "session.revoke")).toBe(true);
    expect(can(mgr, "session.revoke")).toBe(false);
    expect(can(owner, "audit.view")).toBe(true);
    expect(can(sec, "audit.view")).toBe(true);
    expect(can(mgr, "audit.view")).toBe(false);
  });
});
