import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

const auth = vi.hoisted(() => ({ tenantContextFromRequest: vi.fn() }));
const gates = vi.hoisted(() => ({ can: vi.fn() }));
const reports = vi.hoisted(() => ({ getReport: vi.fn(), isReportFinal: vi.fn() }));
const scans = vi.hoisted(() => ({ getScan: vi.fn() }));
const findings = vi.hoisted(() => ({ listFindings: vi.fn() }));
const scopes = vi.hoisted(() => ({ getScopeVersion: vi.fn() }));

vi.mock("@/lib/tenant", () => auth);
vi.mock("@/lib/auth/rbac", () => gates);
vi.mock("@/lib/scan/report", () => reports);
vi.mock("@/lib/scan/service", () => scans);
vi.mock("@/lib/scan/findings", () => findings);
vi.mock("@/lib/scope/service", () => scopes);

const ctx = { userId: "user-a", organizationId: "org-a", role: "report_viewer", isStaff: false, appMode: "dev" };
const report = { id: "report-a", organizationId: "org-a", scanId: "scan-a", status: "attested", summary: { vulnerabilities: 1 }, scopeVersionId: "scope-a", createdAt: new Date("2026-09-09T00:00:00Z"), updatedAt: new Date("2026-09-09T00:00:00Z"), attestation: { status: "attested" } };

function request() { return new NextRequest("http://localhost/api/v1/reports/report-a/download", { headers: { Authorization: "Bearer test" } }); }

describe("report download route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.tenantContextFromRequest.mockResolvedValue(ctx);
    gates.can.mockReturnValue(true);
    reports.getReport.mockResolvedValue(report);
    reports.isReportFinal.mockReturnValue(true);
    scans.getScan.mockResolvedValue({ id: "scan-a", name: "Weekly", status: "COMPLETED", createdAt: new Date("2026-09-09T00:00:00Z"), completedAt: new Date("2026-09-09T01:00:00Z"), targets: [] });
    findings.listFindings.mockResolvedValue([{ id: "finding-a", severity: "4", title: "Example" }]);
    scopes.getScopeVersion.mockResolvedValue({ id: "scope-a", scopeSetId: "set-a", versionNumber: 1, status: "approved", contentHash: "hash", items: [] });
  });

  it("rejects unauthenticated and unauthorized users", async () => {
    auth.tenantContextFromRequest.mockResolvedValueOnce(null);
    expect((await GET(request(), { params: Promise.resolve({ reportId: "report-a" }) })).status).toBe(401);
    auth.tenantContextFromRequest.mockResolvedValueOnce(ctx);
    gates.can.mockReturnValueOnce(false);
    expect((await GET(request(), { params: Promise.resolve({ reportId: "report-a" }) })).status).toBe(403);
  });

  it("returns a downloadable, tenant-scoped report", async () => {
    const response = await GET(request(), { params: Promise.resolve({ reportId: "report-a" }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="report-report-a.json"');
    const body = await response.json();
    expect(body.report.organizationId).toBe("org-a");
    expect(body.final).toBe(true);
    expect(body.findings).toHaveLength(1);
  });

  it("returns not found for a report outside the current tenant", async () => {
    reports.getReport.mockResolvedValueOnce(null);
    expect((await GET(request(), { params: Promise.resolve({ reportId: "report-b" }) })).status).toBe(404);
  });
});
