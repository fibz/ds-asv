// portal/src/lib/auth/keycloak-internal-issuer.test.ts
//
// Own file on purpose: `jwks` is cached in module scope, so the internal-issuer
// URL is only observable before the first verifyToken call in a module
// instance. Production broke because the JWKS was fetched from the PUBLIC
// issuer - which, behind the proxy, means Node being asked to trust a
// self-signed browser-facing certificate.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRemoteJWKSet, jwtVerify } from "jose";

vi.mock("jose", () => ({
  jwtVerify: vi.fn(),
  createRemoteJWKSet: vi.fn(() => ({ mock: "jwks" })),
}));

// verifyToken never touches the database; an empty mock keeps the import cheap.
vi.mock("@/lib/prisma-client", () => ({ prisma: {} }));

const ISSUER = "https://74.156.0.13:8443/auth/realms/asv-portal";
const INTERNAL = "http://keycloak:8080/auth/realms/asv-portal";
const CLIENT_ID = "asv-portal";

const CLAIMS = { sub: "kc-1", email: "u@x.com" };

describe("JWKS under a reverse proxy", () => {
  beforeEach(() => {
    vi.stubEnv("KEYCLOAK_ISSUER", ISSUER);
    vi.stubEnv("KEYCLOAK_CLIENT_ID", CLIENT_ID);
    vi.stubEnv("KEYCLOAK_INTERNAL_ISSUER", INTERNAL);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("fetches certs over the internal issuer when one is configured", async () => {
    const { verifyToken } = await import("@/lib/auth/keycloak");
    vi.mocked(jwtVerify).mockResolvedValueOnce({
      payload: CLAIMS,
      protectedHeader: {},
    } as never);

    await verifyToken("a.b.c");

    expect(createRemoteJWKSet).toHaveBeenCalledWith(
      new URL(`${INTERNAL}/protocol/openid-connect/certs`)
    );
  });

  it("still validates the token against the PUBLIC issuer", async () => {
    const { verifyToken } = await import("@/lib/auth/keycloak");
    vi.mocked(jwtVerify).mockResolvedValueOnce({
      payload: CLAIMS,
      protectedHeader: {},
    } as never);

    await verifyToken("a.b.c");

    // Only the transport is internal. Issuer/audience/alg pinning is unchanged,
    // so a token minted for another client of the realm is still rejected.
    expect(jwtVerify).toHaveBeenCalledWith(
      "a.b.c",
      { mock: "jwks" },
      { issuer: ISSUER, audience: CLIENT_ID, algorithms: ["RS256"] }
    );
  });
});
