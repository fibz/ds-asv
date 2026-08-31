import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma-client";
import { GET } from "./route";

// Mock jose: the route's Bearer verification is our code's contract; jose's
// crypto is not under test here (same pattern as the Task 8 sessions and
// api-keys route tests).
vi.mock("jose", () => ({
  jwtVerify: vi.fn(),
  createRemoteJWKSet: vi.fn(() => ({ mock: "jwks" })),
}));

// Mock prisma: the tx client handed to $transaction is the same mock object.
// R5 (controller ruling): the txMock MUST carry the Task 5 auth path
// (session.findUnique -> null = not blocked, session.upsert for
// recordSessionAccess) AND auditEvent.create/findMany (findMany resolving one
// audit row feeds listAuditEvents through the route).
vi.mock("@/lib/prisma-client", () => {
  const txMock = {
    user: { create: vi.fn(), findUnique: vi.fn() },
    organizationMembership: { findFirst: vi.fn() },
    session: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    auditEvent: { create: vi.fn(), findMany: vi.fn() },
    $executeRawUnsafe: vi.fn(),
  };
  return {
    prisma: {
      ...txMock,
      $transaction: vi.fn((fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock)),
    },
  };
});

const CLAIMS = { sub: "kc-audit-1", email: "owner@x.com" };

const auditRow = {
  id: "ae1",
  organizationId: "org_1",
  actorUserId: "u1",
  action: "scope.submit",
  resourceType: "ScopeVersion",
  resourceId: "sv1",
  reason: "r4-seed",
  before: null,
  after: null,
  createdAt: new Date("2026-08-31T12:00:00.000Z"),
};

function req(path: string) {
  return new NextRequest(`http://localhost${path}`, {
    method: "GET",
    headers: { Authorization: "Bearer a.b.c" },
  });
}

/**
 * A request with a verified Bearer token: jwtVerify + user provisioning
 * (create/findUnique) + membership lookup all succeed for `role`; the
 * session-registry lookups resolve (findUnique -> null = not blocked).
 * auditEvent.findMany resolves one row so listAuditEvents returns it.
 */
function setup(role: string) {
  vi.mocked(jwtVerify).mockResolvedValueOnce({ payload: CLAIMS, protectedHeader: {} } as never);
  vi.mocked(prisma.user.create).mockResolvedValueOnce({
    id: "u1",
    idpId: CLAIMS.sub,
    email: CLAIMS.email,
    orgId: "org_1",
    role: "admin",
  } as never);
  vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
    id: "u1",
    idpId: CLAIMS.sub,
    email: CLAIMS.email,
    orgId: "org_1",
    role: "admin",
  } as never);
  vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({
    userId: "u1",
    organizationId: "org_1",
    role,
    status: "active",
  } as never);
  vi.mocked(prisma.auditEvent.findMany).mockResolvedValue([auditRow] as never);
}

describe("GET /api/v1/audit", () => {
  beforeEach(() => {
    vi.stubEnv("KEYCLOAK_ISSUER", "https://keycloak.example.test/realms/asv");
    vi.stubEnv("KEYCLOAK_CLIENT_ID", "asv-portal");
    vi.stubEnv("APP_MODE", "prod");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("403 for report_viewer (no audit.view)", async () => {
    setup("report_viewer");
    const res = await GET(req("/api/v1/audit"));
    expect(res.status).toBe(403);
  });

  it("400 for limit=500 (out of the 1-100 range)", async () => {
    setup("security_admin");
    const res = await GET(req("/api/v1/audit?limit=500"));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/limit/);
  });

  it("200 for security_admin with the event in the response and nextCursor shape", async () => {
    setup("security_admin");
    const res = await GET(req("/api/v1/audit"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.events).toHaveLength(1);
    expect(data.events[0]).toEqual({
      id: "ae1",
      action: "scope.submit",
      resourceType: "ScopeVersion",
      resourceId: "sv1",
      actorUserId: "u1",
      reason: "r4-seed",
      createdAt: "2026-08-31T12:00:00.000Z",
    });
    expect(data.nextCursor).toBeNull();
  });
});
