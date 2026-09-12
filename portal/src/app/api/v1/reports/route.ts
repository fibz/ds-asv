import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { buildReport, listReports, ReportGuardError } from "@/lib/scan/report";

export async function GET(request: NextRequest) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "report.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const reports = await listReports(ctx);
  return NextResponse.json({ reports });
}

/** Builds (or refreshes) the report for a COMPLETED scan.
 *
 * `buildReport` existed but had no caller, so a report could never come into
 * existence and the Reports screen stayed empty for every scan. Generation is
 * an explicit action rather than a side effect of dispatch: a report is a
 * compliance artifact, and rebuilding it silent on the back of a scan would
 * move a customer's evidence without anyone asking.
 *
 * Idempotent — one report per scan (unique on scanId). Re-posting refreshes the
 * summary, and never re-points a report whose scope version is already linked.
 */
export async function POST(request: NextRequest) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Same people who may run a scan own its report. `report.view` is deliberately
  // not enough: reading a report and generating one are different powers.
  if (!can(ctx, "scan.run")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const scanId = typeof body?.scanId === "string" ? body.scanId.trim() : "";
  if (!scanId) return NextResponse.json({ error: "scanId is required" }, { status: 400 });

  try {
    const report = await buildReport(ctx, scanId);
    return NextResponse.json({ report });
  } catch (e) {
    if (e instanceof ReportGuardError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    const msg = (e as Error).message;
    if (msg === "Scan not found") return NextResponse.json({ error: msg }, { status: 404 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
