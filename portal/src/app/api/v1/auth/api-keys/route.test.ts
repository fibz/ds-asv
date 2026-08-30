import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma-client";
import { POST, GET } from "./route";
import {
  GET as getId,
  PATCH as patchId,
  DELETE as deleteId,
} from "./[id]/route";
import { POST as rotatePost } from "./[id]/rotate/route";

// Mock jose: the route's Bearer verification is our code's contract; jose's
// crypto is not under test here.
vi.mock("jose", () => ({
  jwtVerify: vi.fn(),
  createRemoteJWKSet: vi.fn(() => ({ mock: "jwks" })),
}));

// Mock prisma: the tx client handed to $transaction is the same mock object,
// so resolveTenantContext and the api-key service calls (create/list/update/
// revoke/rotate + audit) all run against one in-memory surface. The mock must
// expose user (create/findUnique — tenantContextFromRequest re-reads the user
// after provisionKeycloakUser's create), organizationMembership (findFirst),
// apiKey (create/findMany/findUnique/update), auditEvent (create), and
// $executeRawUnsafe; $transaction(fn) just calls fn(txMock).
vi.mock("@/lib/prisma-client", () => {
  // the tx client handed to $transaction is the same mock object
  const txMock = {
    user: { create: vi.fn(), findUnique: vi.fn() },
    organizationMembership: { findFirst: vi.fn() },
    apiKey: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    auditEvent: { create: vi.fn() },
    $executeRawUnsafe: vi.fn(),
  };
  return {
    prisma: {
      ...txMock,
      $transaction: vi.fn((fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock)),
    },
  };
});

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

/**
 * A request with a verified Bearer token: auth + provisioning succeed AND
 * tenantContextFromRequest's post-provision user lookup (findUnique) is
 * mocked. Each case sets its own organizationMembership.findFirst once-value
 * BEFORE calling this helper (the role drives the requireRole gate); the
 * once-queue is consumed in order, so the case's value wins.
 */
function authedRequest(path: string, init: RequestInit = {}) {
  vi.mocked(jwtVerify).mockResolvedValueOnce({
    payload: CLAIMS,
    protectedHeader: {},
  } as never);
  vi.mocked(prisma.user.create).mockResolvedValueOnce(userRow() as never);
  vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(userRow() as never);
  return bearerRequest(path, init);
}

const keyRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: "ak_1",
  name: "k",
  keyHash: "salt$hash",
  scopes: ["admin"],
  orgId: "org_1",
  createdAt: new Date(),
  ...overrides,
});

describe("POST /api/v1/auth/api-keys", () => {
  beforeEach(() => {
    vi.stubEnv("KEYCLOAK_ISSUER", "https://keycloak.example.test/realms/asv");
    vi.stubEnv("KEYCLOAK_CLIENT_ID", "asv-portal");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("creates a key and returns the raw key once (201)", async () => {
    vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({ organizationId: "org_1", role: "organization_owner", status: "active" } as never);
    vi.mocked(prisma.apiKey.create).mockResolvedValueOnce({ id: "ak_1", name: "test key", keyHash: "salt$hash", scopes: ["admin"], orgId: "org_1" } as never);
    const request = authedRequest("/api/v1/auth/api-keys", {
      method: "POST",
      body: JSON.stringify({ name: "test key", scopes: ["admin"] }),
    });
    const response = await POST(request);
    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.key).toMatch(/^sk_live_/);
    expect(data.id).toBe("ak_1");
  });

  it("returns 400 for missing name or invalid scopes", async () => {
    vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({ organizationId: "org_1", role: "organization_owner", status: "active" } as never);
    const request = authedRequest("/api/v1/auth/api-keys", {
      method: "POST",
      body: JSON.stringify({ name: "", scopes: ["nope:scope"] }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("returns 401 without a Bearer token", async () => {
    const request = new NextRequest("http://localhost/api/v1/auth/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x", scopes: ["admin"] }),
    });
    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("returns 403 for a non-manager role", async () => {
    vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({ organizationId: "org_1", role: "report_viewer", status: "active" } as never);
    const request = authedRequest("/api/v1/auth/api-keys", {
      method: "POST",
      body: JSON.stringify({ name: "x", scopes: ["admin"] }),
    });
    const response = await POST(request);
    expect(response.status).toBe(403);
  });
});

describe("GET /api/v1/auth/api-keys", () => {
  beforeEach(() => {
    vi.stubEnv("KEYCLOAK_ISSUER", "https://keycloak.example.test/realms/asv");
    vi.stubEnv("KEYCLOAK_CLIENT_ID", "asv-portal");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("lists keys for the tenant (200)", async () => {
    vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({ organizationId: "org_1", role: "organization_owner", status: "active" } as never);
    vi.mocked(prisma.apiKey.findMany).mockResolvedValueOnce([{ id: "ak_1", name: "k", keyHash: "salt$hash", scopes: ["admin"], orgId: "org_1", lastUsedAt: null, expiresAt: null, revokedAt: null, createdAt: new Date() }] as never);
    const request = authedRequest("/api/v1/auth/api-keys");
    const response = await GET(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.keys[0].maskedKey).toMatch(/^sk_live_/);
  });

  it("returns 401 without a Bearer token", async () => {
    const request = new NextRequest("http://localhost/api/v1/auth/api-keys");
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("returns 403 for a non-manager role", async () => {
    vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({ organizationId: "org_1", role: "report_viewer", status: "active" } as never);
    const request = authedRequest("/api/v1/auth/api-keys");
    const response = await GET(request);
    expect(response.status).toBe(403);
  });
});

describe("/api/v1/auth/api-keys/[id] (GET/PATCH/DELETE)", () => {
  beforeEach(() => {
    vi.stubEnv("KEYCLOAK_ISSUER", "https://keycloak.example.test/realms/asv");
    vi.stubEnv("KEYCLOAK_CLIENT_ID", "asv-portal");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("returns the masked single key for GET (200)", async () => {
    vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({ organizationId: "org_1", role: "organization_owner", status: "active" } as never);
    vi.mocked(prisma.apiKey.findUnique).mockResolvedValueOnce(keyRow() as never);
    const response = await getId(
      authedRequest("/api/v1/auth/api-keys/ak_1"),
      { params: Promise.resolve({ id: "ak_1" }) }
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.id).toBe("ak_1");
  });

  it("returns 404 for GET when the key does not exist", async () => {
    vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({ organizationId: "org_1", role: "organization_owner", status: "active" } as never);
    vi.mocked(prisma.apiKey.findUnique).mockResolvedValueOnce(null as never);
    const response = await getId(
      authedRequest("/api/v1/auth/api-keys/nope"),
      { params: Promise.resolve({ id: "nope" }) }
    );
    expect(response.status).toBe(404);
  });

  it("renames a key via PATCH (200)", async () => {
    vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({ organizationId: "org_1", role: "organization_owner", status: "active" } as never);
    vi.mocked(prisma.apiKey.findUnique).mockResolvedValueOnce(keyRow({ name: "old" }) as never);
    vi.mocked(prisma.apiKey.update).mockResolvedValueOnce(keyRow({ name: "renamed" }) as never);
    const response = await patchId(
      authedRequest("/api/v1/auth/api-keys/ak_1", {
        method: "PATCH",
        body: JSON.stringify({ name: "renamed" }),
      }),
      { params: Promise.resolve({ id: "ak_1" }) }
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.name).toBe("renamed");
  });

  it("returns 404 for PATCH when the key does not exist", async () => {
    vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({ organizationId: "org_1", role: "organization_owner", status: "active" } as never);
    vi.mocked(prisma.apiKey.findUnique).mockResolvedValueOnce(null as never);
    const response = await patchId(
      authedRequest("/api/v1/auth/api-keys/nope", {
        method: "PATCH",
        body: JSON.stringify({ name: "x" }),
      }),
      { params: Promise.resolve({ id: "nope" }) }
    );
    expect(response.status).toBe(404);
  });

  it("revokes a key via DELETE (200)", async () => {
    vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({ organizationId: "org_1", role: "organization_owner", status: "active" } as never);
    vi.mocked(prisma.apiKey.findUnique).mockResolvedValueOnce(keyRow() as never);
    vi.mocked(prisma.apiKey.update).mockResolvedValueOnce(keyRow({ revokedAt: new Date() }) as never);
    const response = await deleteId(
      authedRequest("/api/v1/auth/api-keys/ak_1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "ak_1" }) }
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.revoked).toBe(true);
  });

  it("returns 404 for DELETE when the key does not exist", async () => {
    vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({ organizationId: "org_1", role: "organization_owner", status: "active" } as never);
    vi.mocked(prisma.apiKey.findUnique).mockResolvedValueOnce(null as never);
    const response = await deleteId(
      authedRequest("/api/v1/auth/api-keys/nope", { method: "DELETE" }),
      { params: Promise.resolve({ id: "nope" }) }
    );
    expect(response.status).toBe(404);
  });

  it("returns 401 without a Bearer token", async () => {
    const response = await getId(
      new NextRequest("http://localhost/api/v1/auth/api-keys/ak_1"),
      { params: Promise.resolve({ id: "ak_1" }) }
    );
    expect(response.status).toBe(401);
  });
});

describe("POST /api/v1/auth/api-keys/[id]/rotate", () => {
  beforeEach(() => {
    vi.stubEnv("KEYCLOAK_ISSUER", "https://keycloak.example.test/realms/asv");
    vi.stubEnv("KEYCLOAK_CLIENT_ID", "asv-portal");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("rotates a key and returns the new raw key (200)", async () => {
    vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({ organizationId: "org_1", role: "organization_owner", status: "active" } as never);
    vi.mocked(prisma.apiKey.findUnique).mockResolvedValueOnce(keyRow({ name: "rotate-me" }) as never);
    vi.mocked(prisma.apiKey.update).mockResolvedValueOnce(keyRow({ revokedAt: new Date() }) as never);
    vi.mocked(prisma.apiKey.create).mockResolvedValueOnce(keyRow({ id: "ak_2", name: "rotate-me" }) as never);
    const response = await rotatePost(
      authedRequest("/api/v1/auth/api-keys/ak_1/rotate", { method: "POST" }),
      { params: Promise.resolve({ id: "ak_1" }) }
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.key).toMatch(/^sk_live_/);
    expect(data.id).toBe("ak_2");
  });

  it("returns 404 when the key does not exist", async () => {
    vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({ organizationId: "org_1", role: "organization_owner", status: "active" } as never);
    vi.mocked(prisma.apiKey.findUnique).mockResolvedValueOnce(null as never);
    const response = await rotatePost(
      authedRequest("/api/v1/auth/api-keys/nope/rotate", { method: "POST" }),
      { params: Promise.resolve({ id: "nope" }) }
    );
    expect(response.status).toBe(404);
  });

  it("returns 403 for a non-manager role", async () => {
    vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({ organizationId: "org_1", role: "report_viewer", status: "active" } as never);
    const response = await rotatePost(
      authedRequest("/api/v1/auth/api-keys/ak_1/rotate", { method: "POST" }),
      { params: Promise.resolve({ id: "ak_1" }) }
    );
    expect(response.status).toBe(403);
  });

  it("returns 401 without a Bearer token", async () => {
    const request = new NextRequest(
      "http://localhost/api/v1/auth/api-keys/ak_1/rotate",
      { method: "POST" }
    );
    const response = await rotatePost(request, {
      params: Promise.resolve({ id: "ak_1" }),
    });
    expect(response.status).toBe(401);
  });
});
