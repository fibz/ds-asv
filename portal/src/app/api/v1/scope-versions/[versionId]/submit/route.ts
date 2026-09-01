import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { submitScopeVersion } from "@/lib/scope/service";
import { routeErrorResponse } from "@/lib/http-error";

export async function POST(request: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "scope.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { versionId } = await params;
  try {
    const version = await submitScopeVersion(ctx, versionId);
    // Service contract: null means the version does not exist in this org.
    if (!version) return NextResponse.json({ error: "Scope version not found" }, { status: 404 });
    return NextResponse.json({ version });
  } catch (err) {
    return routeErrorResponse(err);
  }
}