import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma-client";
import { PATCH } from "./route";
import { verifyScanManifest } from "@/lib/scan/manifest";

vi.mock("jose", () => ({ jwtVerify: vi.fn(), createRemoteJWKSet: vi.fn(() => ({ mock: "jwks" })) }));

// C1 fix: the PATCH route tries the Bearer token as a scan manifest first,
// then falls through to the user-context path when it does not verify (the
// token is a user's Keycloak JWT). We control verifyScanManifest here to cover
// both the scanner-manifest and user-JWT paths; the real HMAC verifier is
// covered by the manifest tests.
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

const CLAIMS = { sub: "kc-scan-route", email: "op@x.com" };
const SCAN_ID = "scan_patch_route";
const ORG_ID = "org_1";

function req(path: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { Authorization: "Bearer a.b.c", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function setupUser(role: string) {
  vi.mocked(jwtVerify).mockResolvedValue({ payload: CLAIMS, protectedHeader: {} } as never);
  vi.mocked(prisma.user.create).mockResolvedValue({ id: "u1", idpId: CLAIMS.sub, email: CLAIMS.email, orgId: ORG_ID, role: "admin" } as never);
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "u1", idpId: CLAIMS.sub, email: CLAIMS.email, orgId: ORG_ID, role: "admin" } as never);
  vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValue({ userId: "u1", organizationId: ORG_ID, role, status: "active" } as never);
}

// scanRow uses status PENDING so the PENDING -> RUNNING transition is valid.
function setupTransition(status: string) {
  vi.mocked(prisma.scan.findUnique).mockResolvedValue({
    id: SCAN_ID, organizationId: ORG_ID, name: "Q ASV", status: "PENDING", requestedById: "u1",
    manifestIssuedAt: null, manifestExpiresAt: null, startedAt: null, completedAt: null,
    createdAt: new Date(), updatedAt: new Date(),
  } as never);
  vi.mocked(prisma.scan.update).mockResolvedValue({
    id: SCAN_ID, organizationId: ORG_ID, name: "Q ASV", status, requestedById: "u1",
    manifestIssuedAt: null, manifestExpiresAt: null, startedAt: null, completedAt: null,
    createdAt: new Date(), updatedAt: new Date(),
  } as never);
}

describe("scan status route", () => {
  beforeEach(() => {
    vi.stubEnv("APP_MODE", "prod");
    vi.stubEnv("KEYCLOAK_ISSUER", "https://kc.test");
    vi.stubEnv("KEYCLOAK_CLIENT_ID", "test");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

  it("PATCH 200 with a valid scanner manifest for this scanId (scanner path)", async () => {
    vi.mocked(verifyScanManifest).mockResolvedValue({ scanId: SCAN_ID, organizationId: ORG_ID, targets: [] } as never);
    setupTransition("RUNNING");
    const res = await PATCH(
      req(`/api/v1/scans/${SCAN_ID}`, "PATCH", { status: "RUNNING" }),
      { params: Promise.resolve({ scanId: SCAN_ID }) }
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("RUNNING");
    // Scanner path: no user ctx, so orgId comes from the manifest and the
    // transition runs with a synthesized scanner context.
    expect(prisma.scan.update).toHaveBeenCalled();
  });

  it("PATCH 401 when the Bearer verifies as a manifest for a DIFFERENT scan", async () => {
    vi.mocked(verifyScanManifest).mockResolvedValue({ scanId: "scan_other", organizationId: ORG_ID, targets: [] } as never);
    setupUser("scan_operator");
    const res = await PATCH(
      req(`/api/v1/scans/${SCAN_ID}`, "PATCH", { status: "RUNNING" }),
      { params: Promise.resolve({ scanId: SCAN_ID }) }
    );
    expect(res.status).toBe(401);
  });

  it("PATCH 200 with a user ctx that has scan.run (Bearer is a non-verifying user JWT)", async () => {
    vi.mocked(verifyScanManifest).mockResolvedValue(null as never);
    setupUser("scan_operator");
    setupTransition("RUNNING");
    const res = await PATCH(
      req(`/api/v1/scans/${SCAN_ID}`, "PATCH", { status: "RUNNING" }),
      { params: Promise.resolve({ scanId: SCAN_ID }) }
    );
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("RUNNING");
  });

  it("PATCH 401 when the Bearer is not a manifest and there is no valid user ctx", async () => {
    vi.mocked(verifyScanManifest).mockResolvedValue(null as never);
    vi.mocked(jwtVerify).mockRejectedValue(new Error("bad jwt"));
    const res = await PATCH(
      req(`/api/v1/scans/${SCAN_ID}`, "PATCH", { status: "RUNNING" }),
      { params: Promise.resolve({ scanId: SCAN_ID }) }
    );
    expect(res.status).toBe(401);
  });

  it("PATCH 400 for an invalid status", async () => {
    vi.mocked(verifyScanManifest).mockResolvedValue({ scanId: SCAN_ID, organizationId: ORG_ID, targets: [] } as never);
    const res = await PATCH(
      req(`/api/v1/scans/${SCAN_ID}`, "PATCH", { status: "BOGUS" }),
      { params: Promise.resolve({ scanId: SCAN_ID }) }
    );
    expect(res.status).toBe(400);
  });
});
