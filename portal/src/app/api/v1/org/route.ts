import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { getOrgProfile, updateOrgProfile } from "@/lib/org/profile";

export async function GET(request: NextRequest) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "org.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const profile = await getOrgProfile(ctx);
  return NextResponse.json(profile);
}

export async function PATCH(request: NextRequest) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "org.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name : undefined;
  const contacts = Array.isArray(body.contacts) ? body.contacts : undefined;
  try {
    const profile = await updateOrgProfile(ctx, { name, contacts });
    return NextResponse.json(profile);
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
