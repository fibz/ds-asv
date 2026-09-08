import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma-client";
import { getScannerHealth } from "@/lib/scan/health";
import { GET } from "./route";

vi.mock("jose", () => ({ jwtVerify: vi.fn(), createRemoteJWKSet: vi.fn(() => ({ mock: "jwks" })) }));
vi.mock("@/lib/scan/health", () => ({ getScannerHealth: vi.fn() }));
vi.mock("@/lib/prisma-client", () => {
  const txMock = {
    user: { create: vi.fn(), findUnique: vi.fn() },
    organizationMembership: { findFirst: vi.fn() },
    session: { findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
    $executeRawUnsafe: vi.fn(),
  };
  return { prisma: { ...txMock, $transaction: vi.fn((fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock)) } };
});

const CLAIMS = { sub: "kc-scanner-health", email: "operator@example.test" };

function request() {
  return new NextRequest("http://localhost/api/v1/scanner/health", {
    headers: { Authorization: "Bearer a.b.c" },
  });
}

function setupUser(role: string) {
  vi.mocked(jwtVerify).mockResolvedValue({ payload: CLAIMS, protectedHeader: {} } as never);
  vi.mocked(prisma.user.create).mockResolvedValue({ id: "u1", idpId: CLAIMS.sub, email: CLAIMS.email, orgId: "org_1", role: "admin" } as never);
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "u1", idpId: CLAIMS.sub, email: CLAIMS.email, orgId: "org_1", role: "admin" } as never);
  vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValue({ userId: "u1", organizationId: "org_1", role, status: "active" } as never);
}

describe("scanner health route", () => {
  beforeEach(() => {
    vi.stubEnv("APP_MODE", "prod");
    vi.stubEnv("KEYCLOAK_ISSUER", "https://kc.test");
    vi.stubEnv("KEYCLOAK_CLIENT_ID", "test");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

  it("requires authenticated scan.view access", async () => {
    vi.mocked(jwtVerify).mockRejectedValue(new Error("bad jwt"));
    expect((await GET(request())).status).toBe(401);

    setupUser("report_viewer");
    expect((await GET(request())).status).toBe(403);
    expect(getScannerHealth).not.toHaveBeenCalled();
  });

  it("returns the observed scanner health", async () => {
    setupUser("scan_operator");
    vi.mocked(getScannerHealth).mockResolvedValue({ available: true, service: "asv-scanner-api", version: "1.0.0" });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ available: true, service: "asv-scanner-api", version: "1.0.0" });
  });

  it("reports scanner unavailability without treating it as authorization failure", async () => {
    setupUser("scan_operator");
    vi.mocked(getScannerHealth).mockResolvedValue({ available: false, error: "Scanner is unreachable" });
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ available: false, error: "Scanner is unreachable" });
  });
});
