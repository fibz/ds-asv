import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { listActiveSessions } from "@/lib/org/sessions";

export async function GET(request: NextRequest) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "team.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const sessions = await listActiveSessions(ctx);
  return NextResponse.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      userId: s.userId,
      userAgent: s.userAgent,
      lastSeenAt: s.lastSeenAt.toISOString(),
      createdAt: s.createdAt.toISOString(),
      revokedAt: s.revokedAt?.toISOString() ?? null,
    })),
  });
}
