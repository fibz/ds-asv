import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { createScopeVersion } from "@/lib/scope/service";
import { routeErrorResponse } from "@/lib/http-error";

export async function POST(request: NextRequest, { params }: { params: Promise<{ scopeSetId: string }> }) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "scope.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { scopeSetId } = await params;
  const body = await request.json().catch(() => null);
  const assetIds = Array.isArray(body?.assetIds)
    ? body.assetIds.filter((x: unknown) => typeof x === "string")
    : [];
  if (assetIds.length === 0) {
    return NextResponse.json({ error: "assetIds must contain at least one asset" }, { status: 400 });
  }
  try {
    const version = await createScopeVersion(ctx, scopeSetId, { assetIds });
    return NextResponse.json({ version }, { status: 201 });
  } catch (err) {
    return routeErrorResponse(err);
  }
}