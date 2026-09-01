import { prisma } from "@/lib/prisma-client";
import { createRemoteJWKSet, jwtVerify } from "jose";

export interface KeycloakUser {
  idpId: string;
  email: string;
  roles: string[];
}

/**
 * Pure claim → realm roles extractor. Never throws: an absent/malformed
 * realm_access is "no roles", which the caller treats as not-staff.
 */
export function realmRoles(claims: Record<string, unknown>): string[] {
  const ra = claims?.realm_access;
  if (!ra || typeof ra !== "object" || Array.isArray(ra)) return [];
  const roles = (ra as Record<string, unknown>).roles;
  if (!Array.isArray(roles)) return [];
  return roles
    .filter((r): r is string => typeof r === "string")
    .map((r) => r.toLowerCase());
}

/**
 * The Keycloak issuer/client id are read lazily (never at module load) so that
 * importing this module — and running unit tests that mock `jose` — cannot
 * crash when env is not configured. Verification fails closed with a clear
 * error when either is missing at call time.
 */
function keycloakIssuer(): string {
  const issuer = process.env.KEYCLOAK_ISSUER;
  if (!issuer) {
    throw new Error(
      "KEYCLOAK_ISSUER is not set; Keycloak token verification is unavailable"
    );
  }
  return issuer.replace(/\/+$/, "");
}

function keycloakClientId(): string {
  const clientId = process.env.KEYCLOAK_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      "KEYCLOAK_CLIENT_ID is not set; Keycloak token verification is unavailable"
    );
  }
  return clientId;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

/** Lazily built remote JWKS (well-known OIDC certs endpoint) for the issuer. */
function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (!jwks) {
    jwks = createRemoteJWKSet(
      new URL(`${keycloakIssuer()}/protocol/openid-connect/certs`)
    );
  }
  return jwks;
}

/**
 * Verifies a Keycloak access token's signature against the issuer's JWKS and
 * returns its claims. Throws on invalid signatures, wrong issuer, wrong
 * audience (a token minted for ANY OTHER client of the realm is rejected), or
 * expiry.
 */
export async function verifyToken(
  token: string
): Promise<Record<string, unknown>> {
  const { payload } = await jwtVerify(token, getJwks(), {
    issuer: keycloakIssuer(),
    audience: keycloakClientId(),
    // Pin the algorithm family: only RS256-signed tokens are accepted
    // (Keycloak realm default). Defense in depth — without this, jose would
    // accept whatever alg the token header declares (e.g. alg=none).
    algorithms: ["RS256"],
  });
  return payload as Record<string, unknown>;
}

/**
 * Pure claim → user extractor: pulls the IdP subject (`sub`) and email out of
 * verified token claims. Throws when either is missing — provisioning a user
 * without an identity or contact address would corrupt the User table.
 */
export async function getUserFromClaims(
  claims: Record<string, unknown>
): Promise<KeycloakUser> {
  const { sub, email } = claims;
  if (typeof sub !== "string" || sub.length === 0) {
    throw new Error("Keycloak token is missing the subject claim (sub)");
  }
  if (typeof email !== "string" || email.length === 0) {
    throw new Error("Keycloak token is missing the email claim");
  }
  return { idpId: sub, email, roles: realmRoles(claims) };
}

/**
 * Insert-or-fetch a User row for verified Keycloak claims.
 *
 * asv_app has SELECT+INSERT on "User" but NOT UPDATE (fail-closed grant
 * surface), so `upsert` would fail on conflict. We insert-or-fetch instead:
 * a unique violation on `idpId` (P2002) means the user already exists, and we
 * fall back to a plain read. Stale email/role drift is deliberately NOT
 * corrected here — updating identity rows is out of this task's grants.
 */
async function provisionUserFromClaims(
  claims: Record<string, unknown>
): Promise<KeycloakUser> {
  const { idpId, email, roles } = await getUserFromClaims(claims);
  try {
    const user = await prisma.user.create({ data: { idpId, email } });
    return { idpId: user.idpId, email: user.email, roles };
  } catch (error) {
    const existing = await prisma.user.findUnique({ where: { idpId } });
    if (!existing) {
      throw new Error(`Failed to provision Keycloak user ${idpId}`, {
        cause: error,
      });
    }
    return { idpId: existing.idpId, email: existing.email, roles };
  }
}

/**
 * Provisions (or fetches) the DB user for a Keycloak access token. This is the
 * substitute for the old Clerk webhook provisioning.
 */
export async function provisionUserFromToken(
  token: string
): Promise<KeycloakUser> {
  const claims = await verifyToken(token);
  return provisionUserFromClaims(claims);
}

/**
 * Extracts the Bearer token from a request's Authorization header, or null
 * when the header is absent or not a Bearer scheme.
 */
function getBearerToken(request: {
  headers: { get(name: string): string | null };
}): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1] : null;
}

/**
 * Resolves the calling user from a route handler's `Authorization: Bearer`
 * header. Returns null when the header is absent, malformed, or the token
 * fails verification. (Real Keycloak cookie-session integration is a later
 * deployment concern; header-based verification is the testable contract.)
 */
export async function getKeycloakUser(request: {
  headers: { get(name: string): string | null };
}): Promise<KeycloakUser | null> {
  const token = getBearerToken(request);
  if (!token) return null;
  try {
    const claims = await verifyToken(token);
    return await getUserFromClaims(claims);
  } catch {
    return null;
  }
}

/**
 * One-shot verify + provision for route handlers: verifies the Bearer token
 * and ensures a User row exists for the identity (insert-or-fetch). Returns
 * null when the header is absent/malformed or verification fails — callers
 * must respond 401. This is what API routes use so a first-time caller with a
 * valid token gets provisioned before membership/role checks.
 */
export async function provisionKeycloakUser(request: {
  headers: { get(name: string): string | null };
}): Promise<KeycloakUser | null> {
  const token = getBearerToken(request);
  if (!token) return null;
  try {
    const claims = await verifyToken(token);
    return await provisionUserFromClaims(claims);
  } catch {
    return null;
  }
}
