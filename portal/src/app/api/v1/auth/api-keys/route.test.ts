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

// Mock prisma: ApiKey RLS + grants are deferred to Phase 2 (first task), so
// asv_app has NO grants on "ApiKey" — the routes must 501 BEFORE touching the
// table. The mock deliberately exposes NO apiKey surface: if a handler ever
// tried to reach it, the test would blow up instead of seeing a 501, proving
// the short-circuit.
vi.mock("@/lib/prisma-client", () => ({
  prisma: {
    user: {
      create: vi.fn(),
      findUnique: vi.fn(),
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

/** A request with a verified Bearer token: auth + provisioning succeed. */
function authedRequest(path: string, init: RequestInit = {}) {
  vi.mocked(jwtVerify).mockResolvedValueOnce({
    payload: CLAIMS,
    protectedHeader: {},
  } as never);
  vi.mocked(prisma.user.create).mockResolvedValueOnce(userRow() as never);
  return bearerRequest(path, init);
}

// The 501 stubs never touch the path id, so handlers take only the request.
async function expectNotImplemented(response: Response): Promise<void> {
  expect(response.status).toBe(501);
  expect((await response.json()).error).toMatch(/Phase 2/);
}

describe("POST /api/v1/auth/api-keys (deferred surface)", () => {
  beforeEach(() => {
    vi.stubEnv("KEYCLOAK_ISSUER", "https://keycloak.example.test/realms/asv");
    vi.stubEnv("KEYCLOAK_CLIENT_ID", "asv-portal");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("returns 501 for authenticated callers — ApiKey mgmt requires Phase 2", async () => {
    const request = authedRequest("/api/v1/auth/api-keys", {
      method: "POST",
      body: JSON.stringify({ name: "test key", scopes: ["admin"] }),
    });
    // auth + provisioning still happen (that surface is real)…
    await expectNotImplemented(await POST(request));
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: { idpId: "kc-user-99", email: "c@d.com" },
    });
    // …but the handler never reaches the (grant-less) ApiKey table — the
    // mock exposes no apiKey surface, so reaching it would throw, not 501.
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
});

describe("GET /api/v1/auth/api-keys (deferred surface)", () => {
  beforeEach(() => {
    vi.stubEnv("KEYCLOAK_ISSUER", "https://keycloak.example.test/realms/asv");
    vi.stubEnv("KEYCLOAK_CLIENT_ID", "asv-portal");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("returns 501 for authenticated callers — ApiKey mgmt requires Phase 2", async () => {
    await expectNotImplemented(
      await GET(authedRequest("/api/v1/auth/api-keys"))
    );
  });

  it("returns 401 without a Bearer token", async () => {
    const request = new NextRequest("http://localhost/api/v1/auth/api-keys");
    const response = await GET(request);
    expect(response.status).toBe(401);
  });
});

describe("/api/v1/auth/api-keys/[id] (GET/PATCH/DELETE, deferred surface)", () => {
  beforeEach(() => {
    vi.stubEnv("KEYCLOAK_ISSUER", "https://keycloak.example.test/realms/asv");
    vi.stubEnv("KEYCLOAK_CLIENT_ID", "asv-portal");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("returns 501 for GET", async () => {
    await expectNotImplemented(
      await getId(authedRequest("/api/v1/auth/api-keys/ak_1"))
    );
  });

  it("returns 501 for PATCH", async () => {
    await expectNotImplemented(
      await patchId(
        authedRequest("/api/v1/auth/api-keys/ak_1", {
          method: "PATCH",
          body: JSON.stringify({ name: "renamed" }),
        })
      )
    );
  });

  it("returns 501 for DELETE", async () => {
    await expectNotImplemented(
      await deleteId(
        authedRequest("/api/v1/auth/api-keys/ak_1", { method: "DELETE" })
      )
    );
  });

  it("returns 401 without a Bearer token", async () => {
    const response = await getId(
      new NextRequest("http://localhost/api/v1/auth/api-keys/ak_1")
    );
    expect(response.status).toBe(401);
  });
});

describe("POST /api/v1/auth/api-keys/[id]/rotate (deferred surface)", () => {
  beforeEach(() => {
    vi.stubEnv("KEYCLOAK_ISSUER", "https://keycloak.example.test/realms/asv");
    vi.stubEnv("KEYCLOAK_CLIENT_ID", "asv-portal");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("returns 501 for authenticated callers", async () => {
    await expectNotImplemented(
      await rotatePost(
        authedRequest("/api/v1/auth/api-keys/ak_1/rotate", {
          method: "POST",
        })
      )
    );
  });

  it("returns 401 without a Bearer token", async () => {
    const request = new NextRequest(
      "http://localhost/api/v1/auth/api-keys/ak_1/rotate",
      { method: "POST" }
    );
    const response = await rotatePost(request);
    expect(response.status).toBe(401);
  });
});
