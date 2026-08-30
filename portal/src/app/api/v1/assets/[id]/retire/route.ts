import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { retireAsset } from "@/lib/assets/service";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "asset.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  try {
    const retired = await retireAsset(ctx, id);
    return NextResponse.json({ id: retired.id, lifecycleState: retired.lifecycleState });
  } catch (e) {
    console.error("[/api/v1/assets/[id]/retire]", e);
    // only the genuine not-found case is a client 404 — DB failures and other
    // unexpected errors must surface (logged) as 500, not be masked as 404
    if (e instanceof Error && e.message === "Asset not found") {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
