import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { listTeamMembers } from "@/lib/org/team";

export async function GET(request: NextRequest) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "team.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const status = request.nextUrl.searchParams.get("status");
  if (status && status !== "active" && status !== "invited") {
    return NextResponse.json({ error: "status must be active or invited" }, { status: 400 });
  }
  const members = await listTeamMembers(ctx, status === "invited" ? "invited" : "active");
  return NextResponse.json({ members });
}
