import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { createScanFromAssets, listScans } from "@/lib/scan/service";
import { routeErrorResponse } from "@/lib/http-error";

export async function POST(request: NextRequest) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "scan.run")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name : "";
  const assetIds = Array.isArray(body?.assetIds) ? body.assetIds.filter((x: unknown) => typeof x === "string") : [];
  if (!name.trim() || assetIds.length === 0) {
    return NextResponse.json({ error: "name and at least one assetId are required" }, { status: 400 });
  }
  try {
    const scan = await createScanFromAssets(ctx, { name, assetIds });
    return NextResponse.json(scan, { status: 201 });
  } catch (err) {
    return routeErrorResponse(err);
  }
}

export async function GET(request: NextRequest) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "scan.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const scans = await listScans(ctx);
  return NextResponse.json({ scans });
}
