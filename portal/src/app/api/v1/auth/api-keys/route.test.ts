import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma-client";
import { POST, GET } from "./route";

// Mock jose: the route's Bearer verification is our code's contract; jose's
// crypto is not under test here.
vi.mock("jose", () => ({
  jwtVerify: vi.fn(),
  createRemoteJWKSet: vi.fn(() => ({ mock: "jwks" })),
}));

// Mock prisma: prove the handler flow (verify -> provision -> membership ->
// org/role checks -> ApiKey DML) without needing ApiKey grants (Tasks 6-7).
vi.mock("@/lib/prisma-client", () => ({
  prisma: {
    user: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    apiKey: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

const CLAIMS = { sub: "kc-user-99", email: "c@d.com" };

function userRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "u1",
    idpId: "kc-user-99",
    email: "c@d.com",
    orgId: "org_1",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function bearerRequest(path: string, init: RequestInit = {}) {
  return new NextRequest(`http://localhost${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: "Bearer a.b.c",
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
    body: init.body as BodyInit | undefined,
  });
}

describe("POST /api/v1/auth/api-keys (Bearer)", () => {
  beforeEach(() => {
    vi.stubEnv("KEYCLOAK_ISSUER", "https://keycloak.example.test/realms/asv");
    vi.stubEnv("KEYCLOAK_CLIENT_ID", "asv-portal");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("verifies the Bearer token, provisions the user, and creates the key", async () => {
    vi.mocked(jwtVerify).mockResolvedValueOnce({
      payload: CLAIMS,
      protectedHeader: {},
    } as never);
    vi.mocked(prisma.user.create).mockResolvedValueOnce(
      userRow({ orgId: null }) as never
    );
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(
      userRow() as never
    );
    vi.mocked(prisma.apiKey.create).mockResolvedValueOnce({
      id: "ak_1",
      name: "test key",
      keyHash: "salt$hash",
      scopes: ["admin"],
      orgId: "org_1",
      expiresAt: null,
      createdAt: new Date(),
    } as never);

    const request = bearerRequest("/api/v1/auth/api-keys", {
      method: "POST",
      body: JSON.stringify({ name: "test key", scopes: ["admin"] }),
    });
    const response = await POST(request);

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.key).toMatch(/^sk_live_/);
    expect(body.scopes).toEqual(["admin"]);
    // Provisioning happened before the membership/role lookup:
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: { idpId: "kc-user-99", email: "c@d.com" },
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { idpId: "kc-user-99" },
    });
    // The stored hash is a per-key salted value.
    expect(prisma.apiKey.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          keyHash: expect.stringMatching(/^[A-Za-z0-9_-]+\$[0-9a-f]{64}$/),
          orgId: "org_1",
        }),
      })
    );
  });

  it("returns 401 without a Bearer token", async () => {
    const request = new NextRequest("http://localhost/api/v1/auth/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x", scopes: ["admin"] }),
    });
    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("returns 404 when the provisioned user has no org", async () => {
    vi.mocked(jwtVerify).mockResolvedValueOnce({
      payload: CLAIMS,
      protectedHeader: {},
    } as never);
    vi.mocked(prisma.user.create).mockResolvedValueOnce(
      userRow({ orgId: null }) as never
    );
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(
      userRow({ orgId: null }) as never
    );

    const request = bearerRequest("/api/v1/auth/api-keys", {
      method: "POST",
      body: JSON.stringify({ name: "x", scopes: ["admin"] }),
    });
    const response = await POST(request);
    expect(response.status).toBe(404);
  });

  it("returns 403 when the provisioned user is not an admin", async () => {
    vi.mocked(jwtVerify).mockResolvedValueOnce({
      payload: CLAIMS,
      protectedHeader: {},
    } as never);
    vi.mocked(prisma.user.create).mockResolvedValueOnce(
      userRow({ orgId: null }) as never
    );
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(
      userRow({ role: "member" }) as never
    );

    const request = bearerRequest("/api/v1/auth/api-keys", {
      method: "POST",
      body: JSON.stringify({ name: "x", scopes: ["admin"] }),
    });
    const response = await POST(request);
    expect(response.status).toBe(403);
  });
});

describe("GET /api/v1/auth/api-keys (Bearer)", () => {
  beforeEach(() => {
    vi.stubEnv("KEYCLOAK_ISSUER", "https://keycloak.example.test/realms/asv");
    vi.stubEnv("KEYCLOAK_CLIENT_ID", "asv-portal");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("lists the org's keys with masked hashes", async () => {
    vi.mocked(jwtVerify).mockResolvedValueOnce({
      payload: CLAIMS,
      protectedHeader: {},
    } as never);
    vi.mocked(prisma.user.create).mockResolvedValueOnce(
      userRow({ orgId: null }) as never
    );
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(userRow() as never);
    vi.mocked(prisma.apiKey.findMany).mockResolvedValueOnce([
      {
        id: "ak_1",
        name: "test key",
        keyHash: "c2FsdA$abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        scopes: ["admin"],
        orgId: "org_1",
        lastUsedAt: null,
        expiresAt: null,
        revokedAt: null,
        createdAt: new Date(),
      },
    ] as never);

    const response = await GET(bearerRequest("/api/v1/auth/api-keys"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(1);
    expect(body[0].maskedKey).toMatch(/^sk_live_••••••••6789$/);
    // GET also provisions a first-time caller:
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: { idpId: "kc-user-99", email: "c@d.com" },
    });
  });

  it("returns 401 without a Bearer token", async () => {
    const request = new NextRequest("http://localhost/api/v1/auth/api-keys");
    const response = await GET(request);
    expect(response.status).toBe(401);
  });
});
