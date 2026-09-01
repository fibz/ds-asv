import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { issueAuthorization } from "@/lib/scope/authorization";
import { routeErrorResponse } from "@/lib/http-error";

export async function POST(request: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "authorization.issue")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { versionId } = await params;
  try {
    const authorization = await issueAuthorization(ctx, versionId);
    return NextResponse.json({ authorization }, { status: 201 });
  } catch (err) {
    return routeErrorResponse(err);
  }
}