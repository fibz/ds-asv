import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma-client";
import { GET } from "./route";

vi.mock("jose", () => ({ jwtVerify: vi.fn(), createRemoteJWKSet: vi.fn(() => ({ mock: "jwks" })) }));

vi.mock("@/lib/prisma-client", () => {
  const txMock = {
    user: { create: vi.fn(), findUnique: vi.fn() },
    organizationMembership: { findFirst: vi.fn() },
    session: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    report: { findMany: vi.fn() },
    $executeRawUnsafe: vi.fn(),
  };
  return { prisma: { ...txMock, $transaction: vi.fn((fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock)) } };
});

const CLAIMS = { sub: "kc-reports-route", email: "op@x.com" };
const reportRow = { id: "rep_1", scanId: "scan_1", organizationId: "org_1", status: "draft", summary: {}, attestationId: null, scopeVersionId: null, createdAt: new Date(), updatedAt: new Date(), attestation: null };

function req(path: string) {
  return new NextRequest(`http://localhost${path}`, { method: "GET", headers: { Authorization: "Bearer a.b.c" } });
}

function setup(role: string) {
  vi.mocked(jwtVerify).mockResolvedValueOnce({ payload: CLAIMS, protectedHeader: {} } as never);
  vi.mocked(prisma.user.create).mockResolvedValueOnce({ id: "u1", idpId: CLAIMS.sub, email: CLAIMS.email } as never);
  vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: "u1", idpId: CLAIMS.sub, email: CLAIMS.email } as never);
  vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({ userId: "u1", organizationId: "org_1", role, status: "active" } as never);
  vi.mocked(prisma.report.findMany).mockResolvedValue([reportRow] as never);
}

describe("reports list route", () => {
  beforeEach(() => { vi.stubEnv("APP_MODE", "prod"); vi.stubEnv("KEYCLOAK_ISSUER", "https://kc.test"); vi.stubEnv("KEYCLOAK_CLIENT_ID", "test"); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("401 without a verified session, with the spec's error body", async () => {
    const res = await GET(req("/api/v1/reports"));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Unauthorized");
  });

  it("403 when the role lacks report.view, with the spec's error body", async () => {
    setup("asset_manager");
    const res = await GET(req("/api/v1/reports"));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Forbidden");
  });

  it("200 lists reports for report.view roles", async () => {
    setup("report_viewer");
    const res = await GET(req("/api/v1/reports"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reports).toHaveLength(1);
    expect(body.reports[0].id).toBe("rep_1");
  });
});
