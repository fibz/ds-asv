import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { createApiKey, listApiKeys } from "@/lib/auth/api-keys";
import { isScope } from "@/lib/auth/requireScope";

export async function POST(request: NextRequest) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "api-key.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const scopes = Array.isArray(body?.scopes) ? body.scopes.filter(isScope) : [];
  if (!name || scopes.length === 0) {
    return NextResponse.json({ error: "name and at least one valid scope are required" }, { status: 400 });
  }
  const expiresAt = body?.expiresAt ? new Date(body.expiresAt) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) {
    return NextResponse.json({ error: "invalid expiresAt" }, { status: 400 });
  }
  const created = await createApiKey(ctx, { name, scopes, expiresAt });
  return NextResponse.json(
    { id: created.id, name: created.name, key: created.key, scopes: created.scopes, expiresAt: created.expiresAt?.toISOString() ?? null },
    { status: 201 }
  );
}

export async function GET(request: NextRequest) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "api-key.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const keys = await listApiKeys(ctx);
  return NextResponse.json({
    keys: keys.map((k) => ({
      id: k.id, name: k.name, maskedKey: k.maskedKey, scopes: k.scopes,
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      expiresAt: k.expiresAt?.toISOString() ?? null,
      revokedAt: k.revokedAt?.toISOString() ?? null,
      createdAt: k.createdAt.toISOString(),
    })),
  });
}
