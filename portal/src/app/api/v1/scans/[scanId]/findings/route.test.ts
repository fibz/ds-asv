import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma-client";
import { POST, GET } from "./route";
import { verifyScanManifest } from "@/lib/scan/manifest";

vi.mock("jose", () => ({ jwtVerify: vi.fn(), createRemoteJWKSet: vi.fn(() => ({ mock: "jwks" })) }));

// The findings route treats ANY `Authorization: Bearer <token>` as a scanner
// manifest first (POST 401 when it doesn't verify), then falls through to the
// user ctx. To exercise the user-ctx ingest path we control the manifest
// verifier here; the real verifyScanManifest is covered by the manifest tests.
vi.mock("@/lib/scan/manifest", () => ({
  verifyScanManifest: vi.fn(),
  issueScanManifest: vi.fn(),
  simulatedScanner: vi.fn(),
}));

vi.mock("@/lib/prisma-client", () => {
  const txMock = {
    user: { create: vi.fn(), findUnique: vi.fn() },
    organizationMembership: { findFirst: vi.fn() },
    session: { findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(null), upsert: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    asset: { findMany: vi.fn() },
    scan: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    scanTarget: { create: vi.fn(), findMany: vi.fn() },
    auditEvent: { create: vi.fn() },
    finding: { findUnique: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    $executeRawUnsafe: vi.fn(),
  };
  return { prisma: { ...txMock, $transaction: vi.fn((fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock)) } };
});

const CLAIMS = { sub: "kc-findings-route", email: "op@x.com" };
const SCAN_ID = "scan_findings_route";

const validManifest = { scanId: SCAN_ID, organizationId: "org_1", targets: [{ type: "ipv4", canonicalIdentifier: "10.0.0.1" }] };

const scanRow = () => ({
  id: SCAN_ID, organizationId: "org_1", name: "Q ASV", status: "PENDING", requestedById: "u1",
  manifestIssuedAt: null, manifestExpiresAt: null, startedAt: new Date(), completedAt: null,
  createdAt: new Date(), updatedAt: new Date(),
  targets: [{ id: "st1", scanId: SCAN_ID, assetId: "a1", organizationId: "org_1", type: "ipv4", canonicalIdentifier: "10.0.0.1", status: "pending" }],
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

function setupIngest() {
  vi.mocked(verifyScanManifest).mockResolvedValue(validManifest as never);
  vi.mocked(prisma.scan.findUnique).mockResolvedValue(scanRow() as never);
  vi.mocked(prisma.finding.findUnique).mockResolvedValue(null as never);
  vi.mocked(prisma.finding.create).mockResolvedValue({ id: "f1", scanId: SCAN_ID, assetId: "a1", qid: "q1" } as never);
}

describe("scan findings routes", () => {
  beforeEach(() => {
    vi.stubEnv("APP_MODE", "prod");
    vi.stubEnv("KEYCLOAK_ISSUER", "https://kc.test");
    vi.stubEnv("KEYCLOAK_CLIENT_ID", "test");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

  it("POST 401 when the bearer token is not a valid manifest", async () => {
    vi.mocked(verifyScanManifest).mockResolvedValue(null as never);
    const res = await POST(req(`/api/v1/scans/${SCAN_ID}/findings`, "POST", { findings: [] }), { params: Promise.resolve({ scanId: SCAN_ID }) });
    expect(res.status).toBe(401);
  });

  it("POST 201 with a user ctx that has scan.run", async () => {
    setupUser("scan_operator");
    setupIngest();
    const res = await POST(
      req(`/api/v1/scans/${SCAN_ID}/findings`, "POST", { findings: [{ assetId: "a1", qid: "q1", severity: "4", title: "TLS" }] }),
      { params: Promise.resolve({ scanId: SCAN_ID }) }
    );
    expect(res.status).toBe(201);
    expect((await res.json()).count).toBe(1);
  });

  it("POST 400 when the findings array is missing", async () => {
    setupUser("scan_operator");
    setupIngest();
    const res = await POST(req(`/api/v1/scans/${SCAN_ID}/findings`, "POST", { foo: "bar" }), { params: Promise.resolve({ scanId: SCAN_ID }) });
    expect(res.status).toBe(400);
  });

  it("GET 403 for report_viewer", async () => {
    setupUser("report_viewer");
    const res = await GET(req(`/api/v1/scans/${SCAN_ID}/findings`, "GET"), { params: Promise.resolve({ scanId: SCAN_ID }) });
    expect(res.status).toBe(403);
  });
});
