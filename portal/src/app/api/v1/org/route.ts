import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { getOrgProfile, updateOrgProfile } from "@/lib/org/profile";
import { routeErrorResponse } from "@/lib/http-error";

const CONTACT_TYPES = ["business", "security", "billing", "emergency"];

export async function GET(request: NextRequest) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "org.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const profile = await getOrgProfile(ctx);
    return NextResponse.json(profile);
  } catch (err) {
    return routeErrorResponse(err, { notFound: "Organization not found" });
  }
}

export async function PATCH(request: NextRequest) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "org.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  // Pre-validate the body shape for clean 400s before calling the service
  // (the service keeps its own validation as defense-in-depth).
  const name = body.name;
  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "name must be a non-empty string" }, { status: 400 });
    }
    if (name.trim().length > 200) {
      return NextResponse.json({ error: "name must be at most 200 characters" }, { status: 400 });
    }
  }
  const contacts = body.contacts;
  if (contacts !== undefined) {
    if (!Array.isArray(contacts)) {
      return NextResponse.json({ error: "contacts must be an array" }, { status: 400 });
    }
    for (const c of contacts) {
      if (!c || typeof c !== "object") {
        return NextResponse.json({ error: "each contact must be an object" }, { status: 400 });
      }
      if (typeof c.type !== "string" || !CONTACT_TYPES.includes(c.type)) {
        return NextResponse.json(
          { error: `contact type must be one of ${CONTACT_TYPES.join(", ")}` },
          { status: 400 }
        );
      }
      if (typeof c.name !== "string" || c.name.trim().length === 0 ||
          typeof c.email !== "string" || c.email.trim().length === 0) {
        return NextResponse.json({ error: "contact name and email are required" }, { status: 400 });
      }
    }
  }
  try {
    const profile = await updateOrgProfile(ctx, { name, contacts });
    return NextResponse.json(profile);
  } catch (err) {
    return routeErrorResponse(err, { notFound: "Organization not found" });
  }
}
