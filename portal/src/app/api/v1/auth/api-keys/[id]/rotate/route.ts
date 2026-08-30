import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { requireRole } from "@/lib/auth/rbac";
import { rotateApiKey } from "@/lib/auth/api-keys";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requireRole(ctx, "organization_owner", "security_admin");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  try {
    const rotated = await rotateApiKey(ctx, id);
    return NextResponse.json({ id: rotated.id, name: rotated.name, key: rotated.key, scopes: rotated.scopes, expiresAt: rotated.expiresAt?.toISOString() ?? null });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
