import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { createAsset, listAssets, DuplicateAssetError } from "@/lib/assets/service";

export async function POST(request: NextRequest) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "asset.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => null);
  try {
    const asset = await createAsset(ctx, {
      type: body?.type, identifier: body?.identifier,
      displayName: body?.displayName, owner: body?.owner,
      environment: body?.environment, criticality: body?.criticality,
    });
    return NextResponse.json(asset, { status: 201 });
  } catch (e) {
    if (e instanceof DuplicateAssetError) return NextResponse.json({ error: e.message, existingAssetId: e.existingAssetId }, { status: 409 });
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function GET(request: NextRequest) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const assets = await listAssets(ctx, {
    type: searchParams.get("type") ?? undefined,
    lifecycleState: searchParams.get("lifecycleState") ?? undefined,
    criticality: searchParams.get("criticality") ?? undefined,
    search: searchParams.get("search") ?? undefined,
  });
  return NextResponse.json({ assets });
}
