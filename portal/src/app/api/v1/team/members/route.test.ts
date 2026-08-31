import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma-client";
import { GET } from "./route";
import { PATCH, DELETE } from "./[memberId]/route";

vi.mock("jose", () => ({ jwtVerify: vi.fn(), createRemoteJWKSet: vi.fn(() => ({ mock: "jwks" })) }));

vi.mock("@/lib/prisma-client", () => {
  const txMock = {
    user: { create: vi.fn(), findUnique: vi.fn() },
    organizationMembership: {
      findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn(),
    },
    session: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn(), findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    auditEvent: { create: vi.fn(), findMany: vi.fn() },
    $executeRawUnsafe: vi.fn(),
  };
  return { prisma: { ...txMock, $transaction: vi.fn((fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock)) } };
});

const CLAIMS = { sub: "kc-team-1", email: "owner@x.com" };

function req(path: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { Authorization: "Bearer a.b.c", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function setup(role: string, membershipRow?: Record<string, unknown> | null) {
  vi.mocked(jwtVerify).mockResolvedValueOnce({ payload: CLAIMS, protectedHeader: {} } as never);
  vi.mocked(prisma.user.create).mockResolvedValueOnce({ id: "u1", idpId: CLAIMS.sub, email: CLAIMS.email, orgId: "org_1", role: "admin" } as never);
  vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: "u1", idpId: CLAIMS.sub, email: CLAIMS.email, orgId: "org_1", role: "admin" } as never);
  vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({ userId: "u1", organizationId: "org_1", role, status: "active" } as never);
  const mRow = membershipRow === undefined
    ? { id: "m1", userId: "u9", organizationId: "org_1", role: "report_viewer", status: "active", createdAt: new Date(), updatedAt: new Date(), user: { email: "m@x.com" } }
    : membershipRow;
  vi.mocked(prisma.organizationMembership.findUnique).mockResolvedValue(mRow as never);
  vi.mocked(prisma.organizationMembership.findMany).mockResolvedValue([mRow] as never);
  vi.mocked(prisma.organizationMembership.count).mockResolvedValue(2 as never);
  // R12 (plan-bug ruling, test-only): the service reads the update result, so
  // the membership update mock must resolve a row with the requested role.
  vi.mocked(prisma.organizationMembership.update).mockImplementation((args) =>
    Promise.resolve({ ...mRow, ...(args as { data?: { role?: string } }).data } as never)
  );
}

// R11 (plan-bug ruling, test-only): the [memberId] handlers take the Next 16
// `{ params: Promise<{ memberId }> }` second argument (see api-keys route.test.ts).
function params(memberId: string) {
  return { params: Promise.resolve({ memberId }) };
}

describe("team member routes", () => {
  beforeEach(() => { vi.stubEnv("APP_MODE", "prod"); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("GET lists members for team.view roles", async () => {
    setup("asset_manager");
    const res = await GET(req("/api/v1/team/members", "GET"));
    expect(res.status).toBe(200);
    expect((await res.json()).members).toHaveLength(1);
  });

  it("GET is 403 for report_viewer and 400 for a bad status filter", async () => {
    setup("report_viewer");
    expect((await GET(req("/api/v1/team/members", "GET"))).status).toBe(403);
    setup("asset_manager");
    expect((await GET(req("/api/v1/team/members?status=weird", "GET"))).status).toBe(400);
  });

  it("PATCH is 403 for asset_manager and 200 for owner", async () => {
    setup("asset_manager");
    expect((await PATCH(req("/api/v1/team/members/m1", "PATCH", { role: "scan_operator" }), params("m1"))).status).toBe(403);
    setup("organization_owner");
    const res = await PATCH(req("/api/v1/team/members/m1", "PATCH", { role: "scan_operator" }), params("m1"));
    expect(res.status).toBe(200);
    expect((await res.json()).role).toBe("scan_operator");
  });

  it("PATCH is 400 for an invalid role and 404 for an unknown member", async () => {
    setup("organization_owner");
    expect((await PATCH(req("/api/v1/team/members/m1", "PATCH", { role: "superadmin" }), params("m1"))).status).toBe(400);
    setup("organization_owner", null);
    expect((await PATCH(req("/api/v1/team/members/missing", "PATCH", { role: "scan_operator" }), params("missing"))).status).toBe(404);
  });

  it("DELETE is 403 for asset_manager, 404 unknown, 204 for owner", async () => {
    setup("asset_manager");
    expect((await DELETE(req("/api/v1/team/members/m1", "DELETE"), params("m1"))).status).toBe(403);
    setup("organization_owner", null);
    expect((await DELETE(req("/api/v1/team/members/missing", "DELETE"), params("missing"))).status).toBe(404);
    setup("organization_owner");
    expect((await DELETE(req("/api/v1/team/members/m1", "DELETE"), params("m1"))).status).toBe(204);
  });
});
