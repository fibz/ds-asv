import { NextRequest, NextResponse } from "next/server";
import {
  authorizeUrl,
  newOAuthState,
  publicOrigin,
  RETURN_TO_COOKIE,
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
  const origin = publicOrigin(request.nextUrl.origin);
  const redirectUri = `${origin}/api/auth/callback`;
  const state = newOAuthState();
  const url = authorizeUrl(state, { redirectUri });
  const res = NextResponse.redirect(url);
  const opts = sessionCookieOptions({ maxAge: 10 * 60 }); // state only valid ~10 min
  res.cookies.set(STATE_COOKIE, state, opts);
  // Only allow the explicit internal QSA destination; never reflect an
  // arbitrary query value into the post-login redirect.
  const returnTo = request.nextUrl.searchParams.get("returnTo");
  res.cookies.set(RETURN_TO_COOKIE, returnTo === "/qsa" ? "/qsa" : "", {
    ...opts,
    maxAge: returnTo === "/qsa" ? opts.maxAge : 0,
  });
  return res;
}
