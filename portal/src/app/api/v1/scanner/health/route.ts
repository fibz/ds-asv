import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { getScannerHealth } from "@/lib/scan/health";

/** Authenticated portal proxy for the scanner's private liveness endpoint. */
export async function GET(request: NextRequest) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "scan.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const health = await getScannerHealth();
  return NextResponse.json(health, { status: health.available ? 200 : 503 });
}
