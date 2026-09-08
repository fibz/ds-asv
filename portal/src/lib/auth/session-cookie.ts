import { createHash, randomBytes } from "node:crypto";

// Portal session cookie for the Keycloak code-flow login (Phase 8 follow-up:
// "bind cookie session ids into the Session registry"). The cookie carries the
// Keycloak ACCESS TOKEN — the same signed JWT header-auth already verifies —
// so every dashboard request (server components' headers() include the Cookie
// header) reuses the existing verifyToken → provision → Session-registry path.
export const SESSION_COOKIE = "asv_session";
export const STATE_COOKIE = "asv_oauth_state";

function issuer(): string {
  const raw = process.env.KEYCLOAK_ISSUER;
  if (!raw) throw new Error("KEYCLOAK_ISSUER is not set; OIDC login is unavailable");
  return raw.replace(/\/+$/, "");
}

function clientId(): string {
  const raw = process.env.KEYCLOAK_CLIENT_ID;
  if (!raw) throw new Error("KEYCLOAK_CLIENT_ID is not set; OIDC login is unavailable");
  return raw;
}

/** Parses a raw Cookie header into { name: value }. */
export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) out[name] = value;
  }
  return out;
}

export interface RequestLike {
  headers: { get(name: string): string | null };
}

/**
 * Public browser origin for OAuth redirects. Behind a reverse proxy Next can
 * otherwise derive an internal origin such as http://0.0.0.0:3000.
 */
export function publicOrigin(requestOrigin: string): string {
  return (process.env.PUBLIC_ORIGIN ?? requestOrigin).replace(/\/+$/, "");
}

/** The session token for a request: Authorization Bearer, else the session cookie. */
export function sessionTokenFromRequest(request: RequestLike): string | null {
  const auth = request.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (m) return m[1];
  const cookies = parseCookies(request.headers.get("cookie"));
  return cookies[SESSION_COOKIE] ?? null;
}

/** sha256 of a raw session token — the Session-registry key. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newOAuthState(): string {
  return randomBytes(16).toString("hex");
}

export interface OAuthConfig {
  clientId?: string;
  redirectUri: string;
  scope?: string;
}

/** Keycloak authorize endpoint URL for the code flow. */
export function authorizeUrl(state: string, cfg: OAuthConfig): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: cfg.clientId ?? clientId(),
    redirect_uri: cfg.redirectUri,
    scope: cfg.scope ?? "openid email profile",
    state,
  });
  return `${issuer()}/protocol/openid-connect/auth?${params.toString()}`;
}

export interface TokenResponse {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/**
 * Exchanges an authorization code for tokens at the Keycloak token endpoint.
 * Confidential client — the portal client secret from KEYCLOAK_CLIENT_SECRET.
 * Throws on network/HTTP failure; returns the parsed JSON otherwise.
 */
export async function exchangeCode(code: string, redirectUri: string): Promise<TokenResponse> {
  const secret = process.env.KEYCLOAK_CLIENT_SECRET;
  if (!secret) throw new Error("KEYCLOAK_CLIENT_SECRET is not set; OIDC login is unavailable");
  const res = await fetch(`${issuer()}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId(),
      client_secret: secret,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok) {
    throw new Error(
      `token exchange failed (${res.status}): ${data.error_description ?? data.error ?? res.statusText}`
    );
  }
  return data;
}

export interface CookieOptions {
  httpOnly?: boolean;
  sameSite?: "lax" | "strict" | "none";
  secure?: boolean;
  path?: string;
  maxAge?: number;
  domain?: string;
}

/** Cookie policy for the session token. */
export function sessionCookieOptions(over: CookieOptions = {}): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.APP_MODE === "prod",
    path: "/",
    maxAge: 8 * 60 * 60, // Keycloak access tokens default to 5 min; 8h is generous
    ...over,
  };
}

function cookieHeader(name: string, value: string, opts: CookieOptions): string {
  const parts = [`${name}=${value}`];
  if (opts.httpOnly) parts.push("HttpOnly");
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
  if (opts.secure) parts.push("Secure");
  if (opts.path) parts.push(`Path=${opts.path}`);
  if (typeof opts.maxAge === "number") parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  return parts.join("; ");
}

/** set-cookie header for the portal session token. */
export function sessionCookieHeader(token: string, opts: CookieOptions = {}): string {
  return cookieHeader(SESSION_COOKIE, token, sessionCookieOptions(opts));
}

/** set-cookie header that clears the session token (logout). */
export function clearSessionCookieHeader(opts: CookieOptions = {}): string {
  return cookieHeader(SESSION_COOKIE, "", { ...sessionCookieOptions(opts), maxAge: 0 });
}

/** set-cookie header that clears the OAuth state cookie (post-callback). */
export function clearStateCookieHeader(opts: CookieOptions = {}): string {
  return cookieHeader(STATE_COOKIE, "", { ...sessionCookieOptions(opts), maxAge: 0 });
}
