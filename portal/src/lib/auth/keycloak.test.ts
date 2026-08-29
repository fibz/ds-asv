import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { jwtVerify, createRemoteJWKSet } from "jose";
import { prisma } from "@/lib/prisma-client";
import {
  getUserFromClaims,
  verifyToken,
  provisionUserFromToken,
  provisionKeycloakUser,
  getKeycloakUser,
} from "@/lib/auth/keycloak";

// Mock jose so we test OUR token logic, not jose's crypto.
vi.mock("jose", () => ({
  jwtVerify: vi.fn(),
  createRemoteJWKSet: vi.fn(() => ({ mock: "jwks" })),
}));

// Mock prisma so provisioning tests never touch a real database.
vi.mock("@/lib/prisma-client", () => ({
  prisma: {
    user: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

const ISSUER = "https://keycloak.example.test/realms/asv";
const CLIENT_ID = "asv-portal";
const CLAIMS = { sub: "kc-user-99", email: "c@d.com" };

function fakeRequest(authorization: string | null) {
  return {
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "authorization" ? authorization : null,
    },
  };
}

describe("keycloak auth", () => {
  beforeEach(() => {
    vi.stubEnv("KEYCLOAK_ISSUER", ISSUER);
    vi.stubEnv("KEYCLOAK_CLIENT_ID", CLIENT_ID);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("extracts idpId + email from a valid token's claims", async () => {
    const user = await getUserFromClaims(CLAIMS);
    expect(user).toEqual({ idpId: "kc-user-99", email: "c@d.com" });
  });

  it("rejects claims without a subject", async () => {
    await expect(getUserFromClaims({ email: "c@d.com" })).rejects.toThrow(/sub/);
  });

  it("rejects claims without an email", async () => {
    await expect(getUserFromClaims({ sub: "kc-user-99" })).rejects.toThrow(
      /email/i
    );
  });

  it("verifies a token signature and returns its claims", async () => {
    vi.mocked(jwtVerify).mockResolvedValueOnce({
      payload: CLAIMS,
      protectedHeader: {},
    } as never);
    const claims = await verifyToken("a.b.c");
    expect(claims).toEqual(CLAIMS);
    // The JWKS must be fetched from the issuer's OIDC certs endpoint…
    expect(createRemoteJWKSet).toHaveBeenCalledWith(
      new URL(`${ISSUER}/protocol/openid-connect/certs`)
    );
    // …and verification must pin issuer, audience (client id), and the
    // RS256 algorithm family (defense in depth — never accept alg=none).
    expect(jwtVerify).toHaveBeenCalledWith(
      "a.b.c",
      { mock: "jwks" },
      { issuer: ISSUER, audience: CLIENT_ID, algorithms: ["RS256"] }
    );
  });

  it("fails closed when the Keycloak issuer is not configured", async () => {
    vi.stubEnv("KEYCLOAK_ISSUER", "");
    await expect(verifyToken("a.b.c")).rejects.toThrow(/KEYCLOAK_ISSUER/);
  });

  it("fails closed when the Keycloak client id is not configured", async () => {
    vi.stubEnv("KEYCLOAK_CLIENT_ID", "");
    await expect(verifyToken("a.b.c")).rejects.toThrow(/KEYCLOAK_CLIENT_ID/);
  });

  it("creates a user row when provisioning a new idp identity", async () => {
    vi.mocked(jwtVerify).mockResolvedValueOnce({
      payload: CLAIMS,
      protectedHeader: {},
    } as never);
    vi.mocked(prisma.user.create).mockResolvedValueOnce({
      id: "u1",
      idpId: "kc-user-99",
      email: "c@d.com",
      orgId: null,
      role: "member",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const user = await provisionUserFromToken("a.b.c");
    expect(user).toEqual({ idpId: "kc-user-99", email: "c@d.com" });
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: { idpId: "kc-user-99", email: "c@d.com" },
    });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("falls back to fetching the existing user when create hits a conflict", async () => {
    vi.mocked(jwtVerify).mockResolvedValueOnce({
      payload: CLAIMS,
      protectedHeader: {},
    } as never);
    vi.mocked(prisma.user.create).mockRejectedValueOnce(
      new Error("Unique constraint failed (P2002)")
    );
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u1",
      idpId: "kc-user-99",
      email: "existing@example.com",
      orgId: null,
      role: "member",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const user = await provisionUserFromToken("a.b.c");
    expect(user).toEqual({ idpId: "kc-user-99", email: "existing@example.com" });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { idpId: "kc-user-99" },
    });
  });

  it("provisions the user from a valid Bearer request (verify + insert-or-fetch)", async () => {
    vi.mocked(jwtVerify).mockResolvedValueOnce({
      payload: CLAIMS,
      protectedHeader: {},
    } as never);
    vi.mocked(prisma.user.create).mockResolvedValueOnce({
      id: "u1",
      idpId: "kc-user-99",
      email: "c@d.com",
      orgId: null,
      role: "member",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const user = await provisionKeycloakUser(
      fakeRequest("Bearer a.b.c") as never
    );
    expect(user).toEqual({ idpId: "kc-user-99", email: "c@d.com" });
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: { idpId: "kc-user-99", email: "c@d.com" },
    });
  });

  it("returns null from provisionKeycloakUser when the Bearer token is invalid", async () => {
    vi.mocked(jwtVerify).mockRejectedValueOnce(new Error("invalid signature"));
    await expect(
      provisionKeycloakUser(fakeRequest("Bearer bad.token") as never)
    ).resolves.toBeNull();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("returns null from provisionKeycloakUser without an Authorization header", async () => {
    await expect(
      provisionKeycloakUser(fakeRequest(null) as never)
    ).resolves.toBeNull();
  });

  it("returns the user from a Bearer Authorization header", async () => {
    vi.mocked(jwtVerify).mockResolvedValueOnce({
      payload: CLAIMS,
      protectedHeader: {},
    } as never);
    const user = await getKeycloakUser(
      fakeRequest("Bearer a.b.c") as never
    );
    expect(user).toEqual({ idpId: "kc-user-99", email: "c@d.com" });
  });

  it("returns null when no Authorization header is present", async () => {
    await expect(
      getKeycloakUser(fakeRequest(null) as never)
    ).resolves.toBeNull();
  });

  it("returns null for a non-Bearer Authorization header", async () => {
    await expect(
      getKeycloakUser(fakeRequest("Basic abc") as never)
    ).resolves.toBeNull();
  });

  it("returns null when token verification fails", async () => {
    vi.mocked(jwtVerify).mockRejectedValueOnce(new Error("invalid signature"));
    await expect(
      getKeycloakUser(fakeRequest("Bearer bad.token") as never)
    ).resolves.toBeNull();
  });
});
