import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { listScopeSets, createScopeSet } from "@/lib/scope/service";
import { routeErrorResponse } from "@/lib/http-error";

export async function GET(request: NextRequest) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "scope.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const scopeSets = await listScopeSets(ctx);
  return NextResponse.json({ scopeSets });
}

export async function POST(request: NextRequest) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "scope.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name : "";
  if (!name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (body?.description !== undefined && typeof body.description !== "string") {
    return NextResponse.json({ error: "description must be a string" }, { status: 400 });
  }
  try {
    const scopeSet = await createScopeSet(ctx, { name, description: body?.description });
    return NextResponse.json({ scopeSet }, { status: 201 });
  } catch (err) {
    return routeErrorResponse(err);
  }
}