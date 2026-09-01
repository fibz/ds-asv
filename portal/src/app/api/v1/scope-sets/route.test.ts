import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma-client";
import { GET, POST } from "./route";
import { POST as createVersion } from "./[scopeSetId]/versions/route";
import { POST as submit } from "../scope-versions/[versionId]/submit/route";
import { POST as approve } from "../scope-versions/[versionId]/approve/route";
import { POST as issue } from "../scope-versions/[versionId]/authorization/route";
import {
  listScopeSets,
  createScopeSet,
  createScopeVersion,
  submitScopeVersion,
  approveScopeVersion,
  ScopeGuardError,
} from "@/lib/scope/service";
import { issueAuthorization } from "@/lib/scope/authorization";

vi.mock("jose", () => ({ jwtVerify: vi.fn(), createRemoteJWKSet: vi.fn(() => ({ mock: "jwks" })) }));

vi.mock("@/lib/prisma-client", () => {
  const txMock = {
    user: { create: vi.fn(), findUnique: vi.fn() },
    organizationMembership: { findFirst: vi.fn() },
    session: { findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(null), upsert: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    asset: { findMany: vi.fn() },
    auditEvent: { create: vi.fn() },
    $executeRawUnsafe: vi.fn(),
  };
  return { prisma: { ...txMock, $transaction: vi.fn((fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock)) } };
});

// Service layer is mocked so no real DB is touched — the routes are thin
// gate-and-delegate shells; the service logic itself is covered by its own tests.
vi.mock("@/lib/scope/service", () => ({
  listScopeSets: vi.fn(),
  createScopeSet: vi.fn(),
  createScopeVersion: vi.fn(),
  submitScopeVersion: vi.fn(),
  approveScopeVersion: vi.fn(),
  getScopeVersion: vi.fn(),
  ScopeGuardError: class extends Error {},
}));

vi.mock("@/lib/scope/authorization", () => ({
  issueAuthorization: vi.fn(),
  getAuthorization: vi.fn(),
}));

const CLAIMS = { sub: "kc-scope-route", email: "op@x.com" };

const scopeSetRow = (over: Record<string, unknown> = {}) => ({
  id: "s1", organizationId: "org_1", name: "PCI", description: null,
  createdAt: new Date(), updatedAt: new Date(), ...over,
});

const versionRow = (over: Record<string, unknown> = {}) => ({
  id: "v1", scopeSetId: "s1", organizationId: "org_1", versionNumber: 1, status: "draft",
  contentHash: "c", submittedById: null, submittedAt: null, approvedById: null, approvedAt: null,
  createdAt: new Date(), updatedAt: new Date(), ...over,
});

const authorizationRow = (over: Record<string, unknown> = {}) => ({
  id: "auth1", organizationId: "org_1", scopeVersionId: "v1", statementHash: "sh",
  scopeVersionHash: "vh", signature: "sig", status: "issued", issuedById: "u1",
  issuedAt: new Date(), createdAt: new Date(), ...over,
});

function req(path: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method, headers: { Authorization: "Bearer a.b.c", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function setupUser(role: string) {
  vi.mocked(jwtVerify).mockResolvedValue({ payload: CLAIMS, protectedHeader: {} } as never);
  vi.mocked(prisma.user.create).mockResolvedValue({ id: "u1", idpId: CLAIMS.sub, email: CLAIMS.email, orgId: "org_1", role: "admin" } as never);
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "u1", idpId: CLAIMS.sub, email: CLAIMS.email, orgId: "org_1", role: "admin" } as never);
  vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValue({ userId: "u1", organizationId: "org_1", role, status: "active" } as never);
}

describe("scope-set routes", () => {
  beforeEach(() => {
    vi.stubEnv("APP_MODE", "prod");
    vi.stubEnv("KEYCLOAK_ISSUER", "https://kc.test");
    vi.stubEnv("KEYCLOAK_CLIENT_ID", "test");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

  it("GET 401 without a valid user context", async () => {
    vi.mocked(jwtVerify).mockRejectedValue(new Error("bad jwt"));
    expect((await GET(req("/api/v1/scope-sets", "GET"))).status).toBe(401);
  });

  it("GET requires scope.view — 403 for report_viewer", async () => {
    setupUser("report_viewer");
    expect((await GET(req("/api/v1/scope-sets", "GET"))).status).toBe(403);
  });

  it("GET lists scope sets for security_admin", async () => {
    setupUser("security_admin");
    vi.mocked(listScopeSets).mockResolvedValue([scopeSetRow()] as never);
    const res = await GET(req("/api/v1/scope-sets", "GET"));
    expect(res.status).toBe(200);
    expect((await res.json()).scopeSets).toHaveLength(1);
    expect(vi.mocked(listScopeSets)).toHaveBeenCalledTimes(1);
  });

  it("POST requires scope.manage — 403 for report_viewer", async () => {
    setupUser("report_viewer");
    expect((await POST(req("/api/v1/scope-sets", "POST", { name: "PCI" }))).status).toBe(403);
    expect(vi.mocked(createScopeSet)).not.toHaveBeenCalled();
  });

  it("POST creates a scope set for security_admin", async () => {
    setupUser("security_admin");
    vi.mocked(createScopeSet).mockResolvedValue(scopeSetRow() as never);
    const res = await POST(req("/api/v1/scope-sets", "POST", { name: "PCI", description: "in-scope hosts" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.scopeSet).toBeDefined();
    expect(body.scopeSet.name).toBe("PCI");
    expect(vi.mocked(createScopeSet)).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_1", role: "security_admin" }),
      { name: "PCI", description: "in-scope hosts" }
    );
  });

  it("POST 400 for a missing or blank name", async () => {
    setupUser("security_admin");
    expect((await POST(req("/api/v1/scope-sets", "POST", {}))).status).toBe(400);
    expect((await POST(req("/api/v1/scope-sets", "POST", { name: "   " }))).status).toBe(400);
    expect(vi.mocked(createScopeSet)).not.toHaveBeenCalled();
  });
});

describe("scope-set version routes", () => {
  beforeEach(() => {
    vi.stubEnv("APP_MODE", "prod");
    vi.stubEnv("KEYCLOAK_ISSUER", "https://kc.test");
    vi.stubEnv("KEYCLOAK_CLIENT_ID", "test");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

  it("POST creates a version for security_admin (scope.manage)", async () => {
    setupUser("security_admin");
    vi.mocked(createScopeVersion).mockResolvedValue({ ...versionRow(), items: [] } as never);
    const res = await createVersion(
      req("/api/v1/scope-sets/s1/versions", "POST", { assetIds: ["a1", "a2"] }),
      { params: Promise.resolve({ scopeSetId: "s1" }) }
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.version).toBeDefined();
    expect(body.version.id).toBe("v1");
    expect(vi.mocked(createScopeVersion)).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_1" }),
      "s1",
      { assetIds: ["a1", "a2"] }
    );
  });

  it("POST 403 for a role without scope.manage", async () => {
    setupUser("report_viewer");
    const res = await createVersion(
      req("/api/v1/scope-sets/s1/versions", "POST", { assetIds: ["a1"] }),
      { params: Promise.resolve({ scopeSetId: "s1" }) }
    );
    expect(res.status).toBe(403);
  });

  it("POST 400 for missing or empty assetIds", async () => {
    setupUser("security_admin");
    expect((await createVersion(req("/api/v1/scope-sets/s1/versions", "POST", {}), { params: Promise.resolve({ scopeSetId: "s1" }) })).status).toBe(400);
    expect((await createVersion(req("/api/v1/scope-sets/s1/versions", "POST", { assetIds: [] }), { params: Promise.resolve({ scopeSetId: "s1" }) })).status).toBe(400);
  });
});

describe("scope version submit/approve/authorization routes", () => {
  beforeEach(() => {
    vi.stubEnv("APP_MODE", "prod");
    vi.stubEnv("KEYCLOAK_ISSUER", "https://kc.test");
    vi.stubEnv("KEYCLOAK_CLIENT_ID", "test");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

  const params = (versionId: string) => ({ params: Promise.resolve({ versionId }) });

  it("submit POST 200 for security_admin (scope.manage)", async () => {
    setupUser("security_admin");
    vi.mocked(submitScopeVersion).mockResolvedValue(versionRow({ status: "submitted" }) as never);
    const res = await submit(req(`/api/v1/scope-versions/v1/submit`, "POST"), params("v1"));
    expect(res.status).toBe(200);
    expect((await res.json()).version.status).toBe("submitted");
  });

  it("submit POST 404 when the scope version does not exist", async () => {
    setupUser("security_admin");
    vi.mocked(submitScopeVersion).mockResolvedValue(null as never);
    expect((await submit(req("/api/v1/scope-versions/nope/submit", "POST"), params("nope"))).status).toBe(404);
  });

  it("submit POST 409 on ScopeGuardError (wrong status)", async () => {
    setupUser("security_admin");
    vi.mocked(submitScopeVersion).mockRejectedValue(new ScopeGuardError("only draft scope versions can be submitted"));
    expect((await submit(req("/api/v1/scope-versions/v1/submit", "POST"), params("v1"))).status).toBe(409);
  });

  it("approve POST 403 for report_viewer (scope.approve)", async () => {
    setupUser("report_viewer");
    expect((await approve(req("/api/v1/scope-versions/v1/approve", "POST"), params("v1"))).status).toBe(403);
  });

  it("approve POST 200 for security_admin", async () => {
    setupUser("security_admin");
    vi.mocked(approveScopeVersion).mockResolvedValue(versionRow({ status: "approved" }) as never);
    const res = await approve(req("/api/v1/scope-versions/v1/approve", "POST"), params("v1"));
    expect(res.status).toBe(200);
    expect((await res.json()).version.status).toBe("approved");
  });

  it("authorization POST 403 for report_viewer (authorization.issue)", async () => {
    setupUser("report_viewer");
    expect((await issue(req("/api/v1/scope-versions/v1/authorization", "POST"), params("v1"))).status).toBe(403);
  });

  it("authorization POST 201 for security_admin", async () => {
    setupUser("security_admin");
    vi.mocked(issueAuthorization).mockResolvedValue(authorizationRow() as never);
    const res = await issue(req("/api/v1/scope-versions/v1/authorization", "POST"), params("v1"));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.authorization).toBeDefined();
    expect(vi.mocked(issueAuthorization)).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_1" }),
      "v1"
    );
  });

  it("authorization POST 409 on ScopeGuardError (not-approved version)", async () => {
    setupUser("security_admin");
    vi.mocked(issueAuthorization).mockRejectedValue(new ScopeGuardError("authorization requires an approved scope version"));
    expect((await issue(req("/api/v1/scope-versions/v1/authorization", "POST"), params("v1"))).status).toBe(409);
  });
});