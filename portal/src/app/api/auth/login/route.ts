import { NextRequest, NextResponse } from "next/server";
import {
  authorizeUrl,
  newOAuthState,
  RETURN_TO_COOKIE,
  STATE_COOKIE,
  safeReturnTo,
  sessionCookieOptions,
} from "@/lib/auth/session-cookie";

// Keycloak code-flow login: builds the authorize URL and bounces the browser
// to Keycloak. A short-lived `asv_oauth_state` cookie guards the callback, and
// an optional `?returnTo=` (local path only) is remembered so the callback can
// send the user back where they started — the standalone customer UI at /app
// needs this, or signing in there lands in the portal's own UI instead.
export async function GET(request: NextRequest) {
  const issuer = process.env.KEYCLOAK_ISSUER;
  if (!issuer) {
    return NextResponse.json(
      { error: "KEYCLOAK_ISSUER is not set; OIDC login is unavailable" },
      { status: 503 }
    );
  }
  const origin = request.nextUrl.origin;
  const redirectUri = `${origin}/api/auth/callback`;
  const state = newOAuthState();
  const url = authorizeUrl(state, { redirectUri });
  const res = NextResponse.redirect(url);
  const opts = sessionCookieOptions({ maxAge: 10 * 60 }); // state only valid ~10 min
  res.cookies.set(STATE_COOKIE, state, opts);
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get("returnTo"));
  if (returnTo) res.cookies.set(RETURN_TO_COOKIE, returnTo, opts);
  return res;
}
