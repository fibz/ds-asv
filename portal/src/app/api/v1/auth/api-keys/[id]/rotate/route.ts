import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { rotateApiKey } from "@/lib/auth/api-keys";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "api-key.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  try {
    const rotated = await rotateApiKey(ctx, id);
    return NextResponse.json({ id: rotated.id, name: rotated.name, key: rotated.key, scopes: rotated.scopes, expiresAt: rotated.expiresAt?.toISOString() ?? null });
  } catch (e) {
    console.error("[/api/v1/auth/api-keys/[id]/rotate]", e);
    if (e instanceof Error && e.message === "API key not found") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
