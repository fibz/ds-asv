import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma-client";
import { POST } from "./route";
import { dispatchScanToScanner } from "@/lib/scan/dispatch";

vi.mock("jose", () => ({ jwtVerify: vi.fn(), createRemoteJWKSet: vi.fn(() => ({ mock: "jwks" })) }));

// The dispatch route is a thin gate: mock the real scanner dispatch so the
// route test only covers auth/RBAC/status wiring, not the scanner HTTP call.
vi.mock("@/lib/scan/dispatch", () => ({ dispatchScanToScanner: vi.fn() }));

vi.mock("@/lib/prisma-client", () => {
  const txMock = {
    user: { create: vi.fn(), findUnique: vi.fn() },
    organizationMembership: { findFirst: vi.fn() },
    session: { findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(null), upsert: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    scan: { findUnique: vi.fn() },
    $executeRawUnsafe: vi.fn(),
  };
  return { prisma: { ...txMock, $transaction: vi.fn((fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock)) } };
});

const CLAIMS = { sub: "kc-dispatch-route", email: "op@x.com" };
const SCAN_ID = "scan_dispatch_route";

function req(path: string, method: string) {
  return new NextRequest(`http://localhost${path}`, {
    method, headers: { Authorization: "Bearer a.b.c", "Content-Type": "application/json" },
  });
}

function setupUser(role: string) {
  vi.mocked(jwtVerify).mockResolvedValue({ payload: CLAIMS, protectedHeader: {} } as never);
  vi.mocked(prisma.user.create).mockResolvedValue({ id: "u1", idpId: CLAIMS.sub, email: CLAIMS.email, orgId: "org_1", role: "admin" } as never);
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "u1", idpId: CLAIMS.sub, email: CLAIMS.email, orgId: "org_1", role: "admin" } as never);
  vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValue({ userId: "u1", organizationId: "org_1", role, status: "active" } as never);
}

describe("scan dispatch route", () => {
  beforeEach(() => {
    vi.stubEnv("APP_MODE", "prod");
    vi.stubEnv("KEYCLOAK_ISSUER", "https://kc.test");
    vi.stubEnv("KEYCLOAK_CLIENT_ID", "test");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

  it("POST 401 when there is no authenticated tenant context", async () => {
    vi.mocked(jwtVerify).mockRejectedValue(new Error("bad jwt"));
    const res = await POST(req(`/api/v1/scans/${SCAN_ID}/dispatch`, "POST"), { params: Promise.resolve({ scanId: SCAN_ID }) });
    expect(res.status).toBe(401);
  });

  it("POST 403 for report_viewer (lacks scan.run)", async () => {
    setupUser("report_viewer");
    const res = await POST(req(`/api/v1/scans/${SCAN_ID}/dispatch`, "POST"), { params: Promise.resolve({ scanId: SCAN_ID }) });
    expect(res.status).toBe(403);
    expect(dispatchScanToScanner).not.toHaveBeenCalled();
  });

  it("POST 202 for scan_operator with a real dispatch", async () => {
    setupUser("scan_operator");
    vi.mocked(dispatchScanToScanner).mockResolvedValue({ status: "accepted" } as never);
    const res = await POST(req(`/api/v1/scans/${SCAN_ID}/dispatch`, "POST"), { params: Promise.resolve({ scanId: SCAN_ID }) });
    expect(dispatchScanToScanner).toHaveBeenCalledWith(expect.objectContaining({ role: "scan_operator" }), SCAN_ID);
    expect(res.status).toBe(202);
    expect((await res.json()).status).toBe("accepted");
  });

  it("POST 500 when dispatch fails", async () => {
    setupUser("scan_operator");
    vi.mocked(dispatchScanToScanner).mockRejectedValue(new Error("scanner down") as never);
    const res = await POST(req(`/api/v1/scans/${SCAN_ID}/dispatch`, "POST"), { params: Promise.resolve({ scanId: SCAN_ID }) });
    expect(res.status).toBe(500);
  });
});
