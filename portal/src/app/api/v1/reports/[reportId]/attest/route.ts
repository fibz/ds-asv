import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { submitReport, attestReport } from "@/lib/scan/report";
import { routeErrorResponse } from "@/lib/http-error";

export async function POST(request: NextRequest, { params }: { params: Promise<{ reportId: string }> }) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "report.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { reportId } = await params;
  const body = await request.json().catch(() => null);
  const status = typeof body?.status === "string" ? body.status : "";
  const reason = typeof body?.reason === "string" ? body.reason : undefined;
  try {
    let report;
    if (status === "submitted") report = await submitReport(ctx, reportId);
    else if (status === "attested") report = await attestReport(ctx, reportId, { reason });
    else return NextResponse.json({ error: "status must be submitted or attested" }, { status: 400 });
    if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });
    return NextResponse.json(report);
  } catch (err) {
    return routeErrorResponse(err);
  }
}
