import { NextRequest, NextResponse } from "next/server";
import {
  clearReturnToCookieHeader,
  clearStateCookieHeader,
  exchangeCode,
  parseCookies,
  publicOrigin,
  returnToFromCookies,
  sessionCookieHeader,
  STATE_COOKIE,
} from "@/lib/auth/session-cookie";
import { provisionUserFromToken } from "@/lib/auth/keycloak";

// Keycloak code-flow callback: exchanges the authorization code for tokens,
// verifies + provisions the identity through the REAL portal verify path, and
// sets the httpOnly `asv_session` cookie. Every later request carries that
// cookie, so the existing request path verifies the token and records the
// access in the Session registry (revocable in /access).
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  if (!code) {
    return NextResponse.json({ error: "missing authorization code" }, { status: 400 });
  }
  const cookies = parseCookies(request.headers.get("cookie"));
  const savedState = cookies[STATE_COOKIE];
  if (!savedState || !state || savedState !== state) {
    return NextResponse.json({ error: "OAuth state mismatch" }, { status: 400 });
  }

  const origin = publicOrigin(request.nextUrl.origin);
  const redirectUri = `${origin}/api/auth/callback`;
  let token: string;
  try {
    const tokens = await exchangeCode(code, redirectUri);
    if (!tokens.access_token) throw new Error("token exchange returned no access_token");
    token = tokens.access_token;
  } catch (err) {
    console.error("oauth callback token exchange failed:", err);
    return NextResponse.json(
      { error: "Keycloak login failed; try again" },
      { status: 502 }
    );
  }

  // Real verification (signature/issuer/audience) + insert-or-fetch the User.
  try {
    await provisionUserFromToken(token);
  } catch (err) {
    console.error("oauth callback provision failed:", err);
    return NextResponse.json(
      { error: "Keycloak identity could not be verified" },
      { status: 401 }
    );
  }

  // Send the user back where the login started when the caller asked for it
  // (the standalone customer UI passes returnTo=/app/). Local paths only —
  // anything else falls through to the portal's own landing page, which is the
  // historical behaviour and keeps the existing UI working.
  const returnTo = returnToFromCookies(cookies);
  const res = NextResponse.redirect(`${origin}${returnTo ?? "/dashboard"}`);
  res.headers.append("set-cookie", sessionCookieHeader(token));
  res.headers.append("set-cookie", clearStateCookieHeader());
  res.headers.append("set-cookie", clearReturnToCookieHeader());
  return res;
}
