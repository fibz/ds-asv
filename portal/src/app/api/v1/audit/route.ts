import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { listAuditEvents } from "@/lib/audit";

export async function GET(request: NextRequest) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "audit.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const sp = request.nextUrl.searchParams;
  const limit = sp.get("limit") ? Number(sp.get("limit")) : 50;
  const cursor = sp.get("cursor") ?? undefined;
  try {
    const { events, nextCursor } = await listAuditEvents(ctx, {
      action: sp.get("action") ?? undefined,
      resourceType: sp.get("resourceType") ?? undefined,
      limit,
      cursor,
    });
    return NextResponse.json({
      events: events.map((e) => ({
        id: e.id,
        action: e.action,
        resourceType: e.resourceType,
        resourceId: e.resourceId,
        actorUserId: e.actorUserId,
        reason: e.reason,
        createdAt: e.createdAt.toISOString(),
      })),
      nextCursor,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
