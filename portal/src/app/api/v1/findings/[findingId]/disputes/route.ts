import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { raiseDispute } from "@/lib/disputes/service";
import { routeErrorResponse } from "@/lib/http-error";

export async function POST(request: NextRequest, { params }: { params: Promise<{ findingId: string }> }) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "finding.dispute")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { findingId } = await params;
  const body = await request.json().catch(() => null);
  // Route-level shape validation → 400; the service guard (DisputeGuardError)
  // → 409 via routeErrorResponse.
  if (!body || typeof body.justification !== "string" || !body.justification.trim() || body.justification.trim().length > 2000) {
    return NextResponse.json({ error: "justification must be a non-empty string up to 2000 chars" }, { status: 400 });
  }
  try {
    const dispute = await raiseDispute(ctx, findingId, { justification: body.justification });
    return NextResponse.json({ dispute }, { status: 201 });
  } catch (err) {
    return routeErrorResponse(err, { notFound: "Finding not found" });
  }
}