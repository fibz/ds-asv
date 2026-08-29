import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma-client";
import { provisionKeycloakUser } from "@/lib/auth/keycloak";
import { resolveTenantContext, type Role } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { createInvitation, INVITABLE_ROLES } from "@/lib/invitations";

/**
 * POST /api/v1/invitations — create a single-use, expiring invitation.
 *
 * Authn: Bearer token verified via provisionKeycloakUser (401 when absent or
 * invalid). Authz: the org is derived from the CALLER's membership via
 * resolveTenantContext — never from the client body (global constraint) — and
 * the caller must hold the `member.invite` permission. The invited role is
 * validated against the 6-role union (400). The raw token is returned once
 * (201); only its hash is stored.
 */
export async function POST(request: NextRequest) {
  const keycloakUser = await provisionKeycloakUser(request);
  if (!keycloakUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { idpId: keycloakUser.idpId },
  });
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let ctx;
  try {
    ctx = await resolveTenantContext(user.id);
  } catch {
    // no active membership → no tenant to invite into
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!can(ctx, "member.invite", {})) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { email, role } = body;
  if (typeof email !== "string" || email.length === 0 || typeof role !== "string") {
    return NextResponse.json({ error: "email and role are required" }, { status: 400 });
  }
  if (!INVITABLE_ROLES.includes(role as Role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const { token } = await createInvitation(ctx.organizationId, email, role as Role);
  return NextResponse.json({ token, email, role }, { status: 201 });
}
