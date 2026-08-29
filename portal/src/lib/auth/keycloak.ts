import { prisma } from "@/lib/prisma-client";
import { createRemoteJWKSet, jwtVerify } from "jose";

export interface KeycloakUser {
  idpId: string;
  email: string;
}

/**
 * The Keycloak issuer is read lazily (never at module load) so that importing
 * this module — and running unit tests that mock `jose` — cannot crash when
 * KEYCLOAK_ISSUER is not configured. Verification fails closed with a clear
 * error when the issuer is missing at call time.
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
 * returns its claims. Throws on invalid signatures, wrong issuer, or expiry.
 */
export async function verifyToken(
  token: string
): Promise<Record<string, unknown>> {
  const { payload } = await jwtVerify(token, getJwks(), {
    issuer: keycloakIssuer(),
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
  return { idpId: sub, email };
}

/**
 * Provisions (or fetches) the DB user for a Keycloak access token. This is the
 * substitute for the old Clerk webhook provisioning.
 *
 * asv_app has SELECT+INSERT on "User" but NOT UPDATE (fail-closed grant
 * surface), so `upsert` would fail on conflict. We insert-or-fetch instead:
 * a unique violation on `idpId` (P2002) means the user already exists, and we
 * fall back to a plain read. Stale email/role drift is deliberately NOT
 * corrected here — updating identity rows is out of this task's grants.
 */
export async function provisionUserFromToken(
  token: string
): Promise<KeycloakUser> {
  const claims = await verifyToken(token);
  const { idpId, email } = await getUserFromClaims(claims);
  try {
    const user = await prisma.user.create({ data: { idpId, email } });
    return { idpId: user.idpId, email: user.email };
  } catch (error) {
    const existing = await prisma.user.findUnique({ where: { idpId } });
    if (!existing) {
      throw new Error(`Failed to provision Keycloak user ${idpId}`, {
        cause: error,
      });
    }
    return { idpId: existing.idpId, email: existing.email };
  }
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
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return null;
  try {
    const claims = await verifyToken(match[1]);
    return await getUserFromClaims(claims);
  } catch {
    return null;
  }
}
