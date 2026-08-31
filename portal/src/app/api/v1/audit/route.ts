import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { listAuditEvents } from "@/lib/audit";
import { routeErrorResponse } from "@/lib/http-error";

export async function GET(request: NextRequest) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "audit.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const sp = request.nextUrl.searchParams;
  const limitRaw = sp.get("limit");
  const limit = limitRaw === null ? 50 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return NextResponse.json({ error: "limit must be an integer between 1 and 100" }, { status: 400 });
  }
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
    return routeErrorResponse(err);
  }
}
