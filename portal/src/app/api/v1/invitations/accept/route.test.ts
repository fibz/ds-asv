import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma-client";
import { acceptInvitation } from "@/lib/invitations";
import { POST } from "./route";

vi.mock("jose", () => ({
  jwtVerify: vi.fn(),
  createRemoteJWKSet: vi.fn(() => ({ mock: "jwks" })),
}));

vi.mock("@/lib/prisma-client", () => ({
  prisma: {
    user: { create: vi.fn(), findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/invitations", () => ({
  acceptInvitation: vi.fn(),
}));

const CLAIMS = { sub: "kc-invitee-1", email: "new@user.com" };

function userRow() {
  return {
    id: "u_invitee_1",
    idpId: "kc-invitee-1",
    email: "new@user.com",
    orgId: null,
    role: "member",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function membershipRow() {
  return {
    id: "m1",
    userId: "u_invitee_1",
    organizationId: "org_1",
    role: "security_admin",
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function bearerRequest(init: RequestInit = {}) {
  return new NextRequest("http://localhost/api/v1/invitations/accept", {
    method: "POST",
    headers: {
      Authorization: "Bearer a.b.c",
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
    body: init.body as BodyInit | undefined,
  });
}

describe("POST /api/v1/invitations/accept (Bearer)", () => {
  beforeEach(() => {
    vi.stubEnv("KEYCLOAK_ISSUER", "https://keycloak.example.test/realms/asv");
    vi.stubEnv("KEYCLOAK_CLIENT_ID", "asv-portal");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("accepts the invitation for the authenticated identity and returns the membership", async () => {
    vi.mocked(jwtVerify).mockResolvedValueOnce({
      payload: CLAIMS,
      protectedHeader: {},
    } as never);
    vi.mocked(prisma.user.create).mockResolvedValueOnce(userRow() as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(userRow() as never);
    vi.mocked(acceptInvitation).mockResolvedValueOnce(membershipRow() as never);

    const response = await POST(
      bearerRequest({ body: JSON.stringify({ token: "tok_xyz" }) })
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.role).toBe("security_admin");
    expect(body.organizationId).toBe("org_1");
    // the userId bound to the accept is the authenticated identity, never the body
    expect(acceptInvitation).toHaveBeenCalledWith("tok_xyz", "u_invitee_1");
  });

  it("returns 401 without a Bearer token", async () => {
    const request = new NextRequest("http://localhost/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "tok_xyz" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(acceptInvitation).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid, expired, or already-used token", async () => {
    vi.mocked(jwtVerify).mockResolvedValueOnce({
      payload: CLAIMS,
      protectedHeader: {},
    } as never);
    vi.mocked(prisma.user.create).mockResolvedValueOnce(userRow() as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(userRow() as never);
    vi.mocked(acceptInvitation).mockRejectedValueOnce(new Error("Invalid or expired invitation"));

    const response = await POST(
      bearerRequest({ body: JSON.stringify({ token: "used-or-expired" }) })
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 when the token is missing", async () => {
    vi.mocked(jwtVerify).mockResolvedValueOnce({
      payload: CLAIMS,
      protectedHeader: {},
    } as never);
    vi.mocked(prisma.user.create).mockResolvedValueOnce(userRow() as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(userRow() as never);

    const response = await POST(bearerRequest({ body: JSON.stringify({}) }));
    expect(response.status).toBe(400);
    expect(acceptInvitation).not.toHaveBeenCalled();
  });
});
