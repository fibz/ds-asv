import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma-client";
import { POST, GET } from "./route";
import {
  GET as getId,
  PATCH as patchId,
} from "./[id]/route";
import { POST as retirePost } from "./[id]/retire/route";
import { POST as importsPost } from "./imports/route";
import { GET as getImportId } from "./imports/[id]/route";

// Mock jose: the route's Bearer verification is our code's contract; jose's
// crypto is not under test here (mirrors api-keys/route.test.ts).
vi.mock("jose", () => ({
  jwtVerify: vi.fn(),
  createRemoteJWKSet: vi.fn(() => ({ mock: "jwks" })),
}));

// Mock prisma: the tx client handed to $transaction is the same mock object,
// so resolveTenantContext and the asset service/import calls (create/list/get/
// update/retire, preview/apply/getImportResult + audit) all run against one
// in-memory surface. The mock must expose user (create/findUnique —
// tenantContextFromRequest re-reads the user after provisionKeycloakUser's
// create), organizationMembership (findFirst), asset (create/findMany/
// findFirst/update), assetImport (findUnique/create/findFirst), auditEvent
// (create), and $executeRawUnsafe; $transaction(fn) just calls fn(txMock).
vi.mock("@/lib/prisma-client", () => {
  // the tx client handed to $transaction is the same mock object
  const txMock = {
    user: { create: vi.fn(), findUnique: vi.fn() },
    organizationMembership: { findFirst: vi.fn() },
    asset: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    assetImport: { findUnique: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
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

function membershipRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "m1",
    userId: "u1",
    organizationId: "org_1",
    role: "asset_manager",
    status: "active",
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
 * BEFORE calling this helper (the role drives the can() gate); the once-queue
 * is consumed in order, so the case's value wins.
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

const assetRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: "as_1",
  organizationId: "org_1",
  type: "ipv4",
  canonicalIdentifier: "10.0.0.1",
  displayName: null,
  owner: null,
  environment: null,
  criticality: "medium",
  lifecycleState: "pending_verification",
  verificationState: "unverified",
  source: "manual",
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const importRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: "imp_1",
  organizationId: "org_1",
  idempotencyKey: "idem-1",
  status: "completed",
  summary: { total: 1, created: 1, duplicates: 0, invalid: 0 },
  invalidRows: [],
  createdBy: "u1",
  createdAt: new Date(),
  ...overrides,
});

describe("POST /api/v1/assets", () => {
  beforeEach(() => {
    vi.stubEnv("KEYCLOAK_ISSUER", "https://keycloak.example.test/realms/asv");
    vi.stubEnv("KEYCLOAK_CLIENT_ID", "asv-portal");
    // can() only enforces roles when appMode is prod; resolveTenantContext
    // reads APP_MODE via getAppMode(). With prod stubbed, the role-driven 403
    // gate is real while asset_manager still passes the happy paths.
    vi.stubEnv("APP_MODE", "prod");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("returns 401 without a Bearer token", async () => {
    // method: "POST" is required — a GET NextRequest cannot carry a body
    // (Next 15 throws "Request with GET/HEAD method cannot have body").
    const request = new NextRequest("http://localhost/api/v1/assets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "ipv4", identifier: "10.0.0.1" }) });
    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("creates an asset for a manager (201)", async () => {
    vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({ organizationId: "org_1", role: "asset_manager", status: "active" } as never);
    vi.mocked(prisma.asset.create).mockResolvedValueOnce({ id: "as_1", organizationId: "org_1", type: "ipv4", canonicalIdentifier: "10.0.0.1", lifecycleState: "pending_verification", verificationState: "unverified" } as never);
    vi.mocked(prisma.asset.findFirst).mockResolvedValueOnce(null);
    const request = authedRequest("/api/v1/assets", { method: "POST", body: JSON.stringify({ type: "ipv4", identifier: "010.0.0.1", displayName: "web" }) });
    const response = await POST(request);
    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.canonicalIdentifier).toBe("10.0.0.1");
  });

  it("returns 409 on duplicate", async () => {
    vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({ organizationId: "org_1", role: "asset_manager", status: "active" } as never);
    vi.mocked(prisma.asset.findFirst).mockResolvedValueOnce({ id: "as_existing" } as never);
    const request = authedRequest("/api/v1/assets", { method: "POST", body: JSON.stringify({ type: "ipv4", identifier: "10.0.0.1" }) });
    const response = await POST(request);
    expect(response.status).toBe(409);
  });

  it("returns 403 for report_viewer (cannot manage assets)", async () => {
    vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({ organizationId: "org_1", role: "report_viewer", status: "active" } as never);
    const request = authedRequest("/api/v1/assets", { method: "POST", body: JSON.stringify({ type: "ipv4", identifier: "10.0.0.1" }) });
    const response = await POST(request);
    expect(response.status).toBe(403);
  });

  it("lists assets (200)", async () => {
    vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({ organizationId: "org_1", role: "asset_manager", status: "active" } as never);
    vi.mocked(prisma.asset.findMany).mockResolvedValueOnce([{ id: "as_1", type: "ipv4", canonicalIdentifier: "10.0.0.1" }] as never);
    const response = await GET(authedRequest("/api/v1/assets"));
    expect(response.status).toBe(200);
  });
});

describe("GET /api/v1/assets/[id]", () => {
  beforeEach(() => {
    vi.stubEnv("KEYCLOAK_ISSUER", "https://keycloak.example.test/realms/asv");
    vi.stubEnv("KEYCLOAK_CLIENT_ID", "asv-portal");
    vi.stubEnv("APP_MODE", "prod");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("returns the asset detail (200)", async () => {
    vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce(membershipRow() as never);
    vi.mocked(prisma.asset.findFirst).mockResolvedValueOnce(assetRow() as never);
    const response = await getId(
      authedRequest("/api/v1/assets/as_1"),
      { params: Promise.resolve({ id: "as_1" }) }
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.id).toBe("as_1");
  });

  it("returns 404 when the asset does not exist", async () => {
    vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce(membershipRow() as never);
    vi.mocked(prisma.asset.findFirst).mockResolvedValueOnce(null as never);
    const response = await getId(
      authedRequest("/api/v1/assets/nope"),
      { params: Promise.resolve({ id: "nope" }) }
    );
    expect(response.status).toBe(404);
  });

  it("returns 401 without a Bearer token", async () => {
    const response = await getId(
      new NextRequest("http://localhost/api/v1/assets/as_1"),
      { params: Promise.resolve({ id: "as_1" }) }
    );
    expect(response.status).toBe(401);
  });
});

describe("PATCH /api/v1/assets/[id]", () => {
  beforeEach(() => {
    vi.stubEnv("KEYCLOAK_ISSUER", "https://keycloak.example.test/realms/asv");
    vi.stubEnv("KEYCLOAK_CLIENT_ID", "asv-portal");
    vi.stubEnv("APP_MODE", "prod");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("updates cosmetic fields (200)", async () => {
    vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce(membershipRow() as never);
    vi.mocked(prisma.asset.findFirst).mockResolvedValueOnce(assetRow() as never);
    vi.mocked(prisma.asset.update).mockResolvedValueOnce(assetRow({ displayName: "renamed", owner: "team-a" }) as never);
    const response = await patchId(
      authedRequest("/api/v1/assets/as_1", {
        method: "PATCH",
        body: JSON.stringify({ displayName: "renamed", owner: "team-a" }),
      }),
      { params: Promise.resolve({ id: "as_1" }) }
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.displayName).toBe("renamed");
  });

  it("returns 404 when the asset does not exist", async () => {
    vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce(membershipRow() as never);
    vi.mocked(prisma.asset.findFirst).mockResolvedValueOnce(null as never);
    const response = await patchId(
      authedRequest("/api/v1/assets/nope", {
        method: "PATCH",
        body: JSON.stringify({ displayName: "x" }),
      }),
      { params: Promise.resolve({ id: "nope" }) }
    );
    expect(response.status).toBe(404);
  });

  it("returns 403 for report_viewer (cannot manage assets)", async () => {
    vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({ organizationId: "org_1", role: "report_viewer", status: "active" } as never);
    const response = await patchId(
      authedRequest("/api/v1/assets/as_1", {
        method: "PATCH",
        body: JSON.stringify({ displayName: "x" }),
      }),
      { params: Promise.resolve({ id: "as_1" }) }
    );
    expect(response.status).toBe(403);
  });
});

describe("POST /api/v1/assets/[id]/retire", () => {
  beforeEach(() => {
    vi.stubEnv("KEYCLOAK_ISSUER", "https://keycloak.example.test/realms/asv");
    vi.stubEnv("KEYCLOAK_CLIENT_ID", "asv-portal");
    vi.stubEnv("APP_MODE", "prod");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("retires the asset (200)", async () => {
    vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce(membershipRow() as never);
    vi.mocked(prisma.asset.findFirst).mockResolvedValueOnce(assetRow() as never);
    vi.mocked(prisma.asset.update).mockResolvedValueOnce(assetRow({ lifecycleState: "retired" }) as never);
    const response = await retirePost(
      authedRequest("/api/v1/assets/as_1/retire", { method: "POST" }),
      { params: Promise.resolve({ id: "as_1" }) }
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.id).toBe("as_1");
    expect(data.lifecycleState).toBe("retired");
  });

  it("returns 404 when the asset does not exist", async () => {
    vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce(membershipRow() as never);
    vi.mocked(prisma.asset.findFirst).mockResolvedValueOnce(null as never);
    const response = await retirePost(
      authedRequest("/api/v1/assets/nope/retire", { method: "POST" }),
      { params: Promise.resolve({ id: "nope" }) }
    );
    expect(response.status).toBe(404);
  });

  it("returns 403 for report_viewer (cannot manage assets)", async () => {
    vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({ organizationId: "org_1", role: "report_viewer", status: "active" } as never);
    const response = await retirePost(
      authedRequest("/api/v1/assets/as_1/retire", { method: "POST" }),
      { params: Promise.resolve({ id: "as_1" }) }
    );
    expect(response.status).toBe(403);
  });
});

describe("POST /api/v1/assets/imports", () => {
  beforeEach(() => {
    vi.stubEnv("KEYCLOAK_ISSUER", "https://keycloak.example.test/realms/asv");
    vi.stubEnv("KEYCLOAK_CLIENT_ID", "asv-portal");
    vi.stubEnv("APP_MODE", "prod");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("previews a dryRun import (200)", async () => {
    vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce(membershipRow() as never);
    vi.mocked(prisma.asset.findFirst).mockResolvedValueOnce(null as never);
    const request = authedRequest("/api/v1/assets/imports", {
      method: "POST",
      body: JSON.stringify({ csv: "type,identifier\nipv4,10.0.0.1", dryRun: true }),
    });
    const response = await importsPost(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.preview.rows[0].status).toBe("new");
  });

  it("applies an import with an Idempotency-Key (201)", async () => {
    vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce(membershipRow() as never);
    vi.mocked(prisma.asset.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.asset.create).mockResolvedValueOnce(assetRow() as never);
    vi.mocked(prisma.assetImport.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.assetImport.create).mockResolvedValueOnce(importRow() as never);
    const request = authedRequest("/api/v1/assets/imports", {
      method: "POST",
      headers: { "Idempotency-Key": "idem-1" },
      body: JSON.stringify({ csv: "type,identifier\nipv4,10.0.0.1" }),
    });
    const response = await importsPost(request);
    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.importId).toBe("imp_1");
    expect(data.summary.created).toBe(1);
  });

  it("returns 400 for a missing csv body", async () => {
    vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce(membershipRow() as never);
    const request = authedRequest("/api/v1/assets/imports", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const response = await importsPost(request);
    expect(response.status).toBe(400);
  });

  it("returns 400 when Idempotency-Key is missing for a non-dryRun import", async () => {
    vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce(membershipRow() as never);
    const request = authedRequest("/api/v1/assets/imports", {
      method: "POST",
      body: JSON.stringify({ csv: "type,identifier\nipv4,10.0.0.1" }),
    });
    const response = await importsPost(request);
    expect(response.status).toBe(400);
  });

  it("returns 403 for report_viewer (cannot manage assets)", async () => {
    vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({ organizationId: "org_1", role: "report_viewer", status: "active" } as never);
    const request = authedRequest("/api/v1/assets/imports", {
      method: "POST",
      body: JSON.stringify({ csv: "type,identifier\nipv4,10.0.0.1" }),
    });
    const response = await importsPost(request);
    expect(response.status).toBe(403);
  });
});

describe("GET /api/v1/assets/imports/[id]", () => {
  beforeEach(() => {
    vi.stubEnv("KEYCLOAK_ISSUER", "https://keycloak.example.test/realms/asv");
    vi.stubEnv("KEYCLOAK_CLIENT_ID", "asv-portal");
    vi.stubEnv("APP_MODE", "prod");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("returns the import result (200)", async () => {
    vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce(membershipRow() as never);
    vi.mocked(prisma.assetImport.findFirst).mockResolvedValueOnce(importRow() as never);
    const response = await getImportId(
      authedRequest("/api/v1/assets/imports/imp_1"),
      { params: Promise.resolve({ id: "imp_1" }) }
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.id).toBe("imp_1");
  });

  it("returns 404 when the import does not exist", async () => {
    vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce(membershipRow() as never);
    vi.mocked(prisma.assetImport.findFirst).mockResolvedValueOnce(null as never);
    const response = await getImportId(
      authedRequest("/api/v1/assets/imports/nope"),
      { params: Promise.resolve({ id: "nope" }) }
    );
    expect(response.status).toBe(404);
  });

  it("returns 401 without a Bearer token", async () => {
    const response = await getImportId(
      new NextRequest("http://localhost/api/v1/assets/imports/imp_1"),
      { params: Promise.resolve({ id: "imp_1" }) }
    );
    expect(response.status).toBe(401);
  });
});
