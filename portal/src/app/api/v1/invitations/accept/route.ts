import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma-client";
import { provisionKeycloakUser } from "@/lib/auth/keycloak";
import { acceptInvitation } from "@/lib/invitations";

/**
 * POST /api/v1/invitations/accept — redeem an invitation for the
 * authenticated identity.
 *
 * Authn: Bearer token verified via provisionKeycloakUser (401 when absent or
 * invalid). The accepting user does NOT need an existing membership — that is
 * the point of accepting — so no tenant context is resolved here; the accept
 * flow binds the tenant context to the invitation's org internally. The
 * membership is returned on success (201); unknown/expired/already-used tokens
 * map to 400.
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

  const body = await request.json();
  const token = typeof body?.token === "string" ? body.token : null;
  if (!token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  try {
    // The identity's email binds the token to its intended recipient: a
    // forwarded invitation cannot be redeemed by someone else.
    const membership = await acceptInvitation(token, user.id, user.email);
    return NextResponse.json(membership, { status: 201 });
  } catch (error) {
    // The generic 400 is the user-facing contract (never leak internals), but
    // the original error must still reach the logs for diagnosability.
    console.error("[invitations/accept] failed to redeem invitation", error);
    return NextResponse.json(
      { error: "Invalid, expired, or already-used invitation" },
      { status: 400 }
    );
  }
}
