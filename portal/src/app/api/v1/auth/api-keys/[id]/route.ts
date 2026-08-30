import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma-client";
import { tenantContextFromRequest, setRlsContext } from "@/lib/tenant";
import { requireRole } from "@/lib/auth/rbac";
import { updateApiKey, revokeApiKey } from "@/lib/auth/api-keys";
import { isScope } from "@/lib/auth/requireScope";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requireRole(ctx, "organization_owner", "security_admin");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const keys = await listKeysFor(ctx, id);
  if (!keys) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(keys);
}

// local helper: single masked key lookup (RLS-scoped findFirst)
async function listKeysFor(ctx: NonNullable<Awaited<ReturnType<typeof tenantContextFromRequest>>>, id: string) {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    const k = await tx.apiKey.findUnique({ where: { id } });
    if (!k) return null;
    return { id: k.id, name: k.name, scopes: k.scopes, revokedAt: k.revokedAt?.toISOString() ?? null, createdAt: k.createdAt.toISOString() };
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requireRole(ctx, "organization_owner", "security_admin");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const patch: { name?: string; scopes?: string[]; expiresAt?: Date | null } = {};
  if (typeof body?.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (Array.isArray(body?.scopes)) {
    const scopes = body.scopes.filter(isScope);
    if (scopes.length) patch.scopes = scopes;
  }
  if (body?.expiresAt !== undefined) {
    patch.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    if (patch.expiresAt && Number.isNaN(patch.expiresAt.getTime())) {
      return NextResponse.json({ error: "invalid expiresAt" }, { status: 400 });
    }
  }
  try {
    const updated = await updateApiKey(ctx, id, patch);
    return NextResponse.json({ id: updated.id, name: updated.name, scopes: updated.scopes, revokedAt: updated.revokedAt?.toISOString() ?? null });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requireRole(ctx, "organization_owner", "security_admin");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  try {
    await revokeApiKey(ctx, id);
    return NextResponse.json({ id, revoked: true });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
