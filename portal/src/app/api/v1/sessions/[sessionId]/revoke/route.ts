import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { getSession, revokeSession } from "@/lib/org/sessions";

export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { sessionId } = await params;
  const session = await getSession(ctx, sessionId);
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  const isOwn = session.userId === ctx.userId;
  if (!isOwn && !can(ctx, "session.revoke")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const revoked = await revokeSession(ctx, sessionId);
  return NextResponse.json({
    id: revoked!.id,
    userId: revoked!.userId,
    userAgent: revoked!.userAgent,
    lastSeenAt: revoked!.lastSeenAt.toISOString(),
    createdAt: revoked!.createdAt.toISOString(),
    revokedAt: revoked!.revokedAt?.toISOString() ?? null,
  });
}
