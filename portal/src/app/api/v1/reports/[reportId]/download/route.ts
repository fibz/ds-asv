import { NextRequest, NextResponse } from "next/server";
import { can } from "@/lib/auth/rbac";
import { tenantContextFromRequest } from "@/lib/tenant";
import { getScopeVersion } from "@/lib/scope/service";
import { listFindings } from "@/lib/scan/findings";
import { getReport, isReportFinal } from "@/lib/scan/report";
import { getScan } from "@/lib/scan/service";

export async function GET(request: NextRequest, { params }: { params: Promise<{ reportId: string }> }) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "report.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { reportId } = await params;
  const report = await getReport(ctx, reportId);
  if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  const scan = await getScan(ctx, report.scanId);
  if (!scan) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  const findings = await listFindings(ctx, report.scanId);
  const scope = report.scopeVersionId ? await getScopeVersion(ctx, report.scopeVersionId) : null;
  const approvedScopeVersionId = scope?.status === "approved" ? scope.id : null;
  const payload = {
    report: { id: report.id, organizationId: report.organizationId, scanId: report.scanId, status: report.status, summary: report.summary, createdAt: report.createdAt, updatedAt: report.updatedAt },
    attestation: report.attestation,
    scope: scope ? { id: scope.id, scopeSetId: scope.scopeSetId, versionNumber: scope.versionNumber, status: scope.status, contentHash: scope.contentHash, items: scope.items } : null,
    final: isReportFinal({ status: report.status, scopeVersionId: report.scopeVersionId, approvedScopeVersionId }),
    scan: { id: scan.id, name: scan.name, status: scan.status, createdAt: scan.createdAt, completedAt: scan.completedAt, targets: scan.targets },
    findings,
  };
  return new NextResponse(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="report-${report.id}.json"` } });
}
