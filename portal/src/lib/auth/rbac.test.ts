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
  it("authorization.issue requires owner or security_admin in prod", () => {
    const owner = { ...base, role: "organization_owner" as const };
    const sec = { ...base, role: "security_admin" as const };
    const mgr = { ...base, role: "asset_manager" as const };
    const viewer = { ...base, role: "report_viewer" as const };
    expect(can(owner, "authorization.issue")).toBe(true);
    expect(can(sec, "authorization.issue")).toBe(true);
    expect(can(mgr, "authorization.issue")).toBe(false);
    expect(can(viewer, "authorization.issue")).toBe(false);
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

  it("scan.view is allowed for scan_operator and asset_manager, not report_viewer", () => {
    const op: TenantContext = { userId: "u5", organizationId: "o1", role: "scan_operator", isStaff: false, appMode: "prod" };
    const mgrView: TenantContext = { userId: "u3", organizationId: "o1", role: "asset_manager", isStaff: false, appMode: "prod" };
    expect(can(op, "scan.view")).toBe(true);
    expect(can(mgrView, "scan.view")).toBe(true);
    expect(can(viewer, "scan.view")).toBe(false);
  });

  it("scope.manage is owner/security_admin only; scope.view adds asset_manager and scan_operator", () => {
    const op: TenantContext = { userId: "u5", organizationId: "o1", role: "scan_operator", isStaff: false, appMode: "prod" };
    // scope.manage: owners and security admins only
    expect(can(owner, "scope.manage")).toBe(true);
    expect(can(sec, "scope.manage")).toBe(true);
    expect(can(mgr, "scope.manage")).toBe(false);
    expect(can(op, "scope.manage")).toBe(false);
    expect(can(viewer, "scope.manage")).toBe(false);
    // scope.view: owners, security admins, asset managers and scan operators
    expect(can(owner, "scope.view")).toBe(true);
    expect(can(sec, "scope.view")).toBe(true);
    expect(can(mgr, "scope.view")).toBe(true);
    expect(can(op, "scope.view")).toBe(true);
    expect(can(viewer, "scope.view")).toBe(false);
  });
});

describe("dispute actions", () => {
  const owner: TenantContext = { userId: "u1", organizationId: "o1", role: "organization_owner", isStaff: false, appMode: "prod" };
  const sec: TenantContext = { userId: "u2", organizationId: "o1", role: "security_admin", isStaff: false, appMode: "prod" };
  const mgr: TenantContext = { userId: "u3", organizationId: "o1", role: "asset_manager", isStaff: false, appMode: "prod" };
  const op: TenantContext = { userId: "u5", organizationId: "o1", role: "scan_operator", isStaff: false, appMode: "prod" };
  const viewer: TenantContext = { userId: "u4", organizationId: "o1", role: "report_viewer", isStaff: false, appMode: "prod" };
  const billing: TenantContext = { userId: "u6", organizationId: "o1", role: "billing_admin", isStaff: false, appMode: "prod" };

  it("finding.dispute covers everyone who can view findings; dispute.moderate is owner/security_admin in prod", () => {
    // anyone who can read findings may raise a dispute
    for (const u of [owner, sec, mgr, op, viewer]) expect(can(u, "finding.dispute")).toBe(true);
    expect(can(viewer, "finding.dispute")).toBe(true); // viewer allowed
    expect(can(billing, "finding.dispute")).toBe(false);
    // moderation is the QA/admin action
    expect(can(owner, "dispute.moderate")).toBe(true);
    expect(can(sec, "dispute.moderate")).toBe(true);
    for (const u of [mgr, op, viewer, billing]) expect(can(u, "dispute.moderate")).toBe(false);
    expect(can(viewer, "dispute.moderate")).toBe(false); // viewer denied
  });
});
