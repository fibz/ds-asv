import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma-client";
import { POST } from "./route";

vi.mock("jose", () => ({ jwtVerify: vi.fn(), createRemoteJWKSet: vi.fn(() => ({ mock: "jwks" })) }));

vi.mock("@/lib/prisma-client", () => {
  const txMock = {
    user: { create: vi.fn(), findUnique: vi.fn() },
    organizationMembership: { findFirst: vi.fn() },
    session: { findUnique: vi.fn(), findFirst: vi.fn(), upsert: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    report: { findUnique: vi.fn(), update: vi.fn() },
    reportAttestation: { create: vi.fn(), update: vi.fn() },
    auditEvent: { create: vi.fn() },
    $executeRawUnsafe: vi.fn(),
  };
  return { prisma: { ...txMock, $transaction: vi.fn((fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock)) } };
});

const CLAIMS = { sub: "kc-attest", email: "att@x.com" };
const REPORT_ID = "report_attest_route";
const ORG = "org_1";
const USER = "u1";

const reportRow = (over: Record<string, unknown> = {}) => ({
  id: REPORT_ID, organizationId: ORG, scanId: "scan_1", status: "draft",
  summary: {}, attestationId: null, createdAt: new Date(), updatedAt: new Date(), ...over,
});

const attestationRow = () => ({
  id: "att1", reportId: REPORT_ID, organizationId: ORG, status: "submitted",
  reviewedById: USER, reviewedAt: null, reason: null, createdAt: new Date(), updatedAt: new Date(),
});

function req(path: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method, headers: { Authorization: "Bearer a.b.c", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function setupUser(role: string) {
  vi.mocked(jwtVerify).mockResolvedValue({ payload: CLAIMS, protectedHeader: {} } as never);
  vi.mocked(prisma.user.create).mockResolvedValue({ id: USER, idpId: CLAIMS.sub, email: CLAIMS.email } as never);
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: USER, idpId: CLAIMS.sub, email: CLAIMS.email } as never);
  vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValue({ userId: USER, organizationId: ORG, role, status: "active" } as never);
  vi.mocked(prisma.session.findFirst).mockResolvedValue(null as never);
  vi.mocked(prisma.session.upsert).mockResolvedValue({ id: "s1" } as never);
}

describe("report attest route", () => {
  beforeEach(() => {
    vi.stubEnv("KEYCLOAK_ISSUER", "https://kc.test");
    vi.stubEnv("KEYCLOAK_CLIENT_ID", "test");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

  it("POST 400 for an invalid status", async () => {
    vi.stubEnv("APP_MODE", "prod");
    setupUser("report_viewer");
    const res = await POST(req(`/api/v1/reports/${REPORT_ID}/attest`, "POST", { status: "bogus" }), { params: Promise.resolve({ reportId: REPORT_ID }) });
    expect(res.status).toBe(400);
  });

  it("POST 404 for an unknown report", async () => {
    vi.stubEnv("APP_MODE", "prod");
    setupUser("report_viewer");
    vi.mocked(prisma.report.findUnique).mockResolvedValue(null as never);
    const res = await POST(req(`/api/v1/reports/${REPORT_ID}/attest`, "POST", { status: "submitted" }), { params: Promise.resolve({ reportId: REPORT_ID }) });
    expect(res.status).toBe(404);
  });

  it("POST 403 for a non-report.view role", async () => {
    vi.stubEnv("APP_MODE", "prod");
    setupUser("asset_manager");
    const res = await POST(req(`/api/v1/reports/${REPORT_ID}/attest`, "POST", { status: "submitted" }), { params: Promise.resolve({ reportId: REPORT_ID }) });
    expect(res.status).toBe(403);
  });

  it("POST 200 submit for report_viewer", async () => {
    vi.stubEnv("APP_MODE", "prod");
    setupUser("report_viewer");
    const draft = reportRow({ status: "draft" });
    vi.mocked(prisma.report.findUnique).mockResolvedValue(draft as never);
    vi.mocked(prisma.reportAttestation.create).mockResolvedValue(attestationRow() as never);
    vi.mocked(prisma.report.update).mockResolvedValue(reportRow({ status: "submitted", attestationId: "att1" }) as never);
    const res = await POST(req(`/api/v1/reports/${REPORT_ID}/attest`, "POST", { status: "submitted" }), { params: Promise.resolve({ reportId: REPORT_ID }) });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("submitted");
  });

  it("POST 200 attest for report_viewer in test mode (non-staff path)", async () => {
    vi.stubEnv("APP_MODE", "test");
    setupUser("report_viewer");
    const submitted = reportRow({ status: "submitted", attestationId: "att1", attestation: attestationRow() });
    vi.mocked(prisma.report.findUnique).mockResolvedValue(submitted as never);
    vi.mocked(prisma.reportAttestation.update).mockResolvedValue({ ...attestationRow(), status: "attested" } as never);
    vi.mocked(prisma.report.update).mockResolvedValue(reportRow({ status: "attested" }) as never);
    const res = await POST(req(`/api/v1/reports/${REPORT_ID}/attest`, "POST", { status: "attested", reason: "QA ok" }), { params: Promise.resolve({ reportId: REPORT_ID }) });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("attested");
  });
});
