import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { moderateDispute } from "@/lib/disputes/service";
import { routeErrorResponse } from "@/lib/http-error";

export async function POST(request: NextRequest, { params }: { params: Promise<{ disputeId: string }> }) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "dispute.moderate")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { disputeId } = await params;
  const body = await request.json().catch(() => null);
  // Route checks shape (status ∈ resolved|rejected) → 400; the service checks
  // state (staff-in-prod / only-open) → DisputeGuardError → 409.
  if (!body || !["resolved", "rejected"].includes(body.status)) {
    return NextResponse.json({ error: "status must be resolved or rejected" }, { status: 400 });
  }
  try {
    const dispute = await moderateDispute(ctx, disputeId, {
      status: body.status,
      note: typeof body.note === "string" ? body.note : undefined,
    });
    // Service contract: null means the dispute does not exist in this org.
    if (!dispute) return NextResponse.json({ error: "Dispute not found" }, { status: 404 });
    return NextResponse.json({ dispute });
  } catch (err) {
    return routeErrorResponse(err);
  }
}