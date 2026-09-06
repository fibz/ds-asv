import { NextRequest, NextResponse } from "next/server";
import {
  authorizeUrl,
  newOAuthState,
  STATE_COOKIE,
  sessionCookieOptions,
} from "@/lib/auth/session-cookie";

// Keycloak code-flow login: builds the authorize URL and bounces the browser
// to Keycloak. A short-lived `asv_oauth_state` cookie guards the callback.
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
  return res;
}
