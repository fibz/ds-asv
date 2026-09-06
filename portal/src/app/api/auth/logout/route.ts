import { NextRequest, NextResponse } from "next/server";
import {
  clearSessionCookieHeader,
  sessionTokenFromRequest,
} from "@/lib/auth/session-cookie";
import { tenantContextFromRequest } from "@/lib/tenant";
import {
  findSessionByTokenHash,
  hashToken,
  revokeSession,
} from "@/lib/org/sessions";

// Keycloak code-flow logout: revokes the session in the registry (so the
// token is blocked at auth) and clears the `asv_session` cookie. Fails open
// on registry trouble (clears the cookie regardless).
export async function POST(request: NextRequest) {
  const res = NextResponse.redirect(new URL("/sign-in", request.url));
  res.headers.append("set-cookie", clearSessionCookieHeader());
  const token = sessionTokenFromRequest(request);
  if (!token) return res; // nothing to revoke — just clear the cookie
  try {
    const ctx = await tenantContextFromRequest(request);
    if (ctx) {
      // The current session row is keyed by the sha256 of this token.
      const row = await findSessionByTokenHash(ctx, hashToken(token));
      if (row && !row.revokedAt) await revokeSession(ctx, row.id, "logout");
    }
  } catch {
    // Availability over registry — cookie is already cleared.
  }
  return res;
}
