import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { getReport } from "@/lib/scan/report";

export async function GET(request: NextRequest, { params }: { params: Promise<{ reportId: string }> }) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "report.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { reportId } = await params;
  const report = await getReport(ctx, reportId);
  if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  return NextResponse.json(report);
}
