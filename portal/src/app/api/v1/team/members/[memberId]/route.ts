import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest, isRole, ROLES } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { updateMemberRole, removeMember } from "@/lib/org/team";
import { routeErrorResponse } from "@/lib/http-error";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ memberId: string }> }) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "team.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { memberId } = await params;
  const body = await request.json().catch(() => null);
  const role = typeof body?.role === "string" ? body.role : "";
  if (!isRole(role)) {
    return NextResponse.json({ error: `role must be one of: ${ROLES.join(", ")}` }, { status: 400 });
  }
  try {
    const member = await updateMemberRole(ctx, memberId, role);
    if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });
    return NextResponse.json(member);
  } catch (err) {
    return routeErrorResponse(err);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ memberId: string }> }) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "team.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { memberId } = await params;
  try {
    const removed = await removeMember(ctx, memberId);
    if (!removed) return NextResponse.json({ error: "Member not found" }, { status: 404 });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return routeErrorResponse(err);
  }
}
