import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma-client";
import {
  getUserFromClaims,
  verifyToken,
  provisionUserFromToken,
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
    expect(jwtVerify).toHaveBeenCalledWith("a.b.c", expect.anything(), {
      issuer: ISSUER,
    });
  });

  it("fails closed when the Keycloak issuer is not configured", async () => {
    vi.stubEnv("KEYCLOAK_ISSUER", "");
    await expect(verifyToken("a.b.c")).rejects.toThrow(/KEYCLOAK_ISSUER/);
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
