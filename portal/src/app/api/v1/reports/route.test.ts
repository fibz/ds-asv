import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma-client";
import { POST } from "./route";
import { buildReport, ReportGuardError } from "@/lib/scan/report";

vi.mock("jose", () => ({ jwtVerify: vi.fn(), createRemoteJWKSet: vi.fn(() => ({ mock: "jwks" })) }));

// The route is a thin gate; the report build itself is covered in
// src/lib/scan/report.test.ts. Mock it so this file covers auth/RBAC and the
// error-to-status mapping only.
vi.mock("@/lib/scan/report", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scan/report")>();
  return { ...actual, buildReport: vi.fn() };
});

vi.mock("@/lib/prisma-client", () => {
  const txMock = {
    user: { create: vi.fn(), findUnique: vi.fn() },
    organizationMembership: { findFirst: vi.fn() },
    session: { findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(null), upsert: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    $executeRawUnsafe: vi.fn(),
  };
  return { prisma: { ...txMock, $transaction: vi.fn((fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock)) } };
});

const CLAIMS = { sub: "kc-report-route", email: "op@x.com" };
const SCAN_ID = "scan_report_route";

function req(method: string, body?: unknown) {
  return new NextRequest("http://localhost/api/v1/reports", {
    method,
    headers: { Authorization: "Bearer a.b.c", "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function setupUser(role: string) {
  vi.mocked(jwtVerify).mockResolvedValue({ payload: CLAIMS, protectedHeader: {} } as never);
  vi.mocked(prisma.user.create).mockResolvedValue({ id: "u1", idpId: CLAIMS.sub, email: CLAIMS.email, orgId: "org_1", role: "admin" } as never);
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "u1", idpId: CLAIMS.sub, email: CLAIMS.email, orgId: "org_1", role: "admin" } as never);
  vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValue({ userId: "u1", organizationId: "org_1", role, status: "active" } as never);
}

describe("reports POST route", () => {
  beforeEach(() => {
    vi.stubEnv("APP_MODE", "prod");
    vi.stubEnv("KEYCLOAK_ISSUER", "https://kc.test");
    vi.stubEnv("KEYCLOAK_CLIENT_ID", "test");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

  it("401 when there is no authenticated tenant context", async () => {
    vi.mocked(jwtVerify).mockRejectedValue(new Error("bad jwt"));
    const res = await POST(req("POST", { scanId: SCAN_ID }));
    expect(res.status).toBe(401);
    expect(buildReport).not.toHaveBeenCalled();
  });

  it("403 for report_viewer — reading a report is not generating one", async () => {
    setupUser("report_viewer");
    const res = await POST(req("POST", { scanId: SCAN_ID }));
    expect(res.status).toBe(403);
    expect(buildReport).not.toHaveBeenCalled();
  });

  it("400 when scanId is missing or blank", async () => {
    setupUser("scan_operator");
    expect((await POST(req("POST", {}))).status).toBe(400);
    expect((await POST(req("POST", { scanId: "   " }))).status).toBe(400);
    expect(buildReport).not.toHaveBeenCalled();
  });

  it("404 when the scan is not in this organization", async () => {
    setupUser("scan_operator");
    vi.mocked(buildReport).mockRejectedValue(new Error("Scan not found"));
    const res = await POST(req("POST", { scanId: SCAN_ID }));
    expect(res.status).toBe(404);
  });

  it("409 when the scan has not completed", async () => {
    setupUser("scan_operator");
    vi.mocked(buildReport).mockRejectedValue(new ReportGuardError("report requires a COMPLETED scan"));
    const res = await POST(req("POST", { scanId: SCAN_ID }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/COMPLETED/);
  });

  it("200 and returns the report for a scan_operator", async () => {
    setupUser("scan_operator");
    vi.mocked(buildReport).mockResolvedValue({ id: "rep_1", scanId: SCAN_ID, status: "draft" } as never);
    const res = await POST(req("POST", { scanId: SCAN_ID }));
    expect(res.status).toBe(200);
    expect(buildReport).toHaveBeenCalledWith(expect.objectContaining({ role: "scan_operator" }), SCAN_ID);
    expect((await res.json()).report.id).toBe("rep_1");
  });
});
