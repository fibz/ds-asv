import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma-client";
import { createInvitation } from "@/lib/invitations";
import { POST } from "./route";

// Mock jose: the route's Bearer verification is our code's contract; jose's
// crypto is not under test here (mirrors api-keys/route.test.ts).
vi.mock("jose", () => ({
  jwtVerify: vi.fn(),
  createRemoteJWKSet: vi.fn(() => ({ mock: "jwks" })),
}));

// The route derives the org from the caller's membership via
// resolveTenantContext (prisma.$transaction + organizationMembership.findFirst)
// and provisions/loads the identity via prisma.user — mock both so the handler
// flow is testable without a live Keycloak/DB (the lib itself is real-DB-tested).
const fakeTx = {
  $executeRawUnsafe: vi.fn(),
  organizationMembership: { findFirst: vi.fn() },
};

vi.mock("@/lib/prisma-client", () => ({
  prisma: {
    user: { create: vi.fn(), findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

// Keep the real role whitelist (used by the route's 400 validation) but stub
// the DB-touching lib function.
vi.mock("@/lib/invitations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/invitations")>()),
  createInvitation: vi.fn(),
}));

const CLAIMS = { sub: "kc-inviter-1", email: "inviter@corp.com" };

function userRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "u_inviter_1",
    idpId: "kc-inviter-1",
    email: "inviter@corp.com",
    orgId: null,
    role: "member",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function membershipRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "m1",
    userId: "u_inviter_1",
    organizationId: "org_1",
    role: "organization_owner",
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function bearerRequest(init: RequestInit = {}) {
  return new NextRequest("http://localhost/api/v1/invitations", {
    method: "POST",
    headers: {
      Authorization: "Bearer a.b.c",
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
    body: init.body as BodyInit | undefined,
  });
}

describe("POST /api/v1/invitations (Bearer)", () => {
  beforeEach(() => {
    vi.stubEnv("KEYCLOAK_ISSUER", "https://keycloak.example.test/realms/asv");
    vi.stubEnv("KEYCLOAK_CLIENT_ID", "asv-portal");
    vi.mocked(prisma.$transaction).mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (fn: any) => fn(fakeTx)
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("creates an invitation with the org derived from the caller's membership, never the body", async () => {
    vi.mocked(jwtVerify).mockResolvedValueOnce({
      payload: CLAIMS,
      protectedHeader: {},
    } as never);
    vi.mocked(prisma.user.create).mockResolvedValueOnce(userRow() as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(userRow() as never);
    vi.mocked(fakeTx.organizationMembership.findFirst).mockResolvedValueOnce(
      membershipRow() as never
    );
    vi.mocked(createInvitation).mockResolvedValueOnce({ token: "tok_xyz" } as never);

    const request = bearerRequest({
      body: JSON.stringify({
        email: "new@user.com",
        role: "security_admin",
        // a client-supplied orgId must be ignored
        organizationId: "org_evil_9999",
      }),
    });
    const response = await POST(request);

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({ token: "tok_xyz", email: "new@user.com", role: "security_admin" });
    expect(createInvitation).toHaveBeenCalledWith("org_1", "new@user.com", "security_admin");
  });

  it("returns 401 without a Bearer token", async () => {
    const request = new NextRequest("http://localhost/api/v1/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "new@user.com", role: "security_admin" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(createInvitation).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller has no active membership", async () => {
    vi.mocked(jwtVerify).mockResolvedValueOnce({
      payload: CLAIMS,
      protectedHeader: {},
    } as never);
    vi.mocked(prisma.user.create).mockResolvedValueOnce(userRow() as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(userRow() as never);
    vi.mocked(fakeTx.organizationMembership.findFirst).mockResolvedValueOnce(null as never);

    const response = await POST(
      bearerRequest({ body: JSON.stringify({ email: "new@user.com", role: "security_admin" }) })
    );
    expect(response.status).toBe(403);
    expect(createInvitation).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller's role lacks member.invite (prod gate enforced)", async () => {
    vi.stubEnv("APP_MODE", "prod");
    vi.mocked(jwtVerify).mockResolvedValueOnce({
      payload: CLAIMS,
      protectedHeader: {},
    } as never);
    vi.mocked(prisma.user.create).mockResolvedValueOnce(userRow() as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(userRow() as never);
    vi.mocked(fakeTx.organizationMembership.findFirst).mockResolvedValueOnce(
      membershipRow({ role: "report_viewer" }) as never
    );

    const response = await POST(
      bearerRequest({ body: JSON.stringify({ email: "new@user.com", role: "security_admin" }) })
    );
    expect(response.status).toBe(403);
    expect(createInvitation).not.toHaveBeenCalled();
  });

  it("returns 400 for a role outside the 6-role union", async () => {
    vi.mocked(jwtVerify).mockResolvedValueOnce({
      payload: CLAIMS,
      protectedHeader: {},
    } as never);
    vi.mocked(prisma.user.create).mockResolvedValueOnce(userRow() as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(userRow() as never);
    vi.mocked(fakeTx.organizationMembership.findFirst).mockResolvedValueOnce(
      membershipRow() as never
    );

    const response = await POST(
      bearerRequest({ body: JSON.stringify({ email: "new@user.com", role: "super_admin" }) })
    );
    expect(response.status).toBe(400);
    expect(createInvitation).not.toHaveBeenCalled();
  });
});
