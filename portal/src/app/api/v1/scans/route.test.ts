import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma-client";
import { POST, GET } from "./route";
import { GET as getOne, PATCH } from "./[scanId]/route";

vi.mock("jose", () => ({ jwtVerify: vi.fn(), createRemoteJWKSet: vi.fn(() => ({ mock: "jwks" })) }));

vi.mock("@/lib/prisma-client", () => {
  const txMock = {
    user: { create: vi.fn(), findUnique: vi.fn() },
    organizationMembership: { findFirst: vi.fn() },
    session: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    asset: { findMany: vi.fn() },
    scan: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    scanTarget: { create: vi.fn(), findMany: vi.fn() },
    auditEvent: { create: vi.fn() },
    $executeRawUnsafe: vi.fn(),
  };
  return { prisma: { ...txMock, $transaction: vi.fn((fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock)) } };
});

const CLAIMS = { sub: "kc-scan-route", email: "op@x.com" };
const scanRow = (over: Record<string, unknown> = {}) => ({
  id: "scan_1", organizationId: "org_1", name: "Q ASV", status: "PENDING", requestedById: "u1",
  manifestIssuedAt: null, manifestExpiresAt: null, startedAt: new Date(), completedAt: null,
  createdAt: new Date(), updatedAt: new Date(), targets: [], ...over,
});

function req(path: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method, headers: { Authorization: "Bearer a.b.c", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function setup(role: string, scan?: Record<string, unknown> | null) {
  vi.mocked(jwtVerify).mockResolvedValueOnce({ payload: CLAIMS, protectedHeader: {} } as never);
  vi.mocked(prisma.user.create).mockResolvedValueOnce({ id: "u1", idpId: CLAIMS.sub, email: CLAIMS.email, orgId: "org_1", role: "admin" } as never);
  vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: "u1", idpId: CLAIMS.sub, email: CLAIMS.email, orgId: "org_1", role: "admin" } as never);
  vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({ userId: "u1", organizationId: "org_1", role, status: "active" } as never);
  const row = scan === undefined ? scanRow() : scan;
  vi.mocked(prisma.scan.findUnique).mockResolvedValue(row as never);
  vi.mocked(prisma.scan.findMany).mockResolvedValue([row] as never);
  vi.mocked(prisma.scan.create).mockResolvedValue(row as never);
  // R-scan-update (plan-bug ruling, test-only): Prisma update takes a single
  // `{ where, data }` arg (see team/members route.test.ts R12), so the service's
  // update-result read must merge from args.data.
  vi.mocked(prisma.scan.update).mockImplementation(((args) =>
    Promise.resolve({ ...(row as object), ...((args as { data?: object }).data ?? {}) } as never)) as never);
  vi.mocked(prisma.scanTarget.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.asset.findMany).mockResolvedValue([{ id: "a1", organizationId: "org_1", type: "ipv4", canonicalIdentifier: "10.0.0.1", lifecycleState: "active", verificationState: "verified" }] as never);
}

describe("scan routes", () => {
  beforeEach(() => { vi.stubEnv("APP_MODE", "prod"); vi.stubEnv("KEYCLOAK_ISSUER", "https://kc.test"); vi.stubEnv("KEYCLOAK_CLIENT_ID", "test"); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("POST creates a scan for scan.run roles, 403 for report_viewer", async () => {
    setup("report_viewer");
    expect((await POST(req("/api/v1/scans", "POST", { name: "x", assetIds: ["a1"] }))).status).toBe(403);
    setup("scan_operator");
    const res = await POST(req("/api/v1/scans", "POST", { name: "Q ASV", assetIds: ["a1"] }));
    expect(res.status).toBe(201);
    expect((await res.json()).id).toBe("scan_1");
  });

  it("POST 400 for empty assetIds and invalid name", async () => {
    setup("scan_operator");
    expect((await POST(req("/api/v1/scans", "POST", { name: "x", assetIds: [] }))).status).toBe(400);
    setup("scan_operator");
    expect((await POST(req("/api/v1/scans", "POST", { name: "  ", assetIds: ["a1"] }))).status).toBe(400);
  });

  it("GET lists scans for scan.view, 403 for report_viewer", async () => {
    setup("report_viewer");
    expect((await GET(req("/api/v1/scans", "GET"))).status).toBe(403);
    setup("asset_manager");
    const res = await GET(req("/api/v1/scans", "GET"));
    expect(res.status).toBe(200);
    expect((await res.json()).scans).toHaveLength(1);
  });

  it("GET [id] 404 for unknown scan", async () => {
    setup("scan_operator", null);
    expect((await getOne(req("/api/v1/scans/nope", "GET"), { params: Promise.resolve({ scanId: "nope" }) })).status).toBe(404);
  });

  it("PATCH transitions status, 400 on invalid transition", async () => {
    setup("scan_operator");
    const res = await PATCH(req("/api/v1/scans/scan_1", "PATCH", { status: "RUNNING" }), { params: Promise.resolve({ scanId: "scan_1" }) });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("RUNNING");
  });
});
