import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma-client";
import { GET } from "./route";
import { POST } from "./[sessionId]/revoke/route";

vi.mock("jose", () => ({ jwtVerify: vi.fn(), createRemoteJWKSet: vi.fn(() => ({ mock: "jwks" })) }));

vi.mock("@/lib/prisma-client", () => {
  const txMock = {
    user: { create: vi.fn(), findUnique: vi.fn() },
    organizationMembership: { findFirst: vi.fn() },
    session: { findUnique: vi.fn(), upsert: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    auditEvent: { create: vi.fn() },
    $executeRawUnsafe: vi.fn(),
  };
  return { prisma: { ...txMock, $transaction: vi.fn((fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock)) } };
});

const CLAIMS = { sub: "kc-sess-1", email: "owner@x.com" };

const sessionRow = (over: Record<string, unknown> = {}) => ({
  id: "s1", organizationId: "org_1", userId: "u9", tokenHash: "h", userAgent: "curl", ipHash: null,
  lastSeenAt: new Date(), createdAt: new Date(), revokedAt: null, revokedById: null, ...over,
});

function req(path: string, method: string) {
  return new NextRequest(`http://localhost${path}`, { method, headers: { Authorization: "Bearer a.b.c" } });
}

function setup(role: string, sessionOverrides?: Record<string, unknown> | null) {
  vi.mocked(jwtVerify).mockResolvedValueOnce({ payload: CLAIMS, protectedHeader: {} } as never);
  vi.mocked(prisma.user.create).mockResolvedValueOnce({ id: "u1", idpId: CLAIMS.sub, email: CLAIMS.email, orgId: "org_1", role: "admin" } as never);
  vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: "u1", idpId: CLAIMS.sub, email: CLAIMS.email, orgId: "org_1", role: "admin" } as never);
  vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({ userId: "u1", organizationId: "org_1", role, status: "active" } as never);
  const row = sessionOverrides === undefined ? sessionRow() : sessionOverrides;
  vi.mocked(prisma.session.findUnique).mockResolvedValue(row as never);
  vi.mocked(prisma.session.findMany).mockResolvedValue([row] as never);
  vi.mocked(prisma.session.update).mockImplementation((() => Promise.resolve({ ...(row as object), revokedAt: new Date(), revokedById: "u1" })) as never);
}

// R11 (plan-bug ruling, test-only): the revoke handler takes the Next 16
// `{ params: Promise<{ sessionId }> }` second argument (see api-keys route.test.ts).
function params(sessionId: string) {
  return { params: Promise.resolve({ sessionId }) };
}

describe("session routes", () => {
  beforeEach(() => {
    vi.stubEnv("KEYCLOAK_ISSUER", "https://keycloak.test");
    vi.stubEnv("KEYCLOAK_CLIENT_ID", "test-client");
    vi.stubEnv("APP_MODE", "prod");
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("GET lists sessions for team.view roles, 403 for viewers", async () => {
    setup("report_viewer");
    expect((await GET(req("/api/v1/sessions", "GET"))).status).toBe(403);
    setup("security_admin");
    const res = await GET(req("/api/v1/sessions", "GET"));
    expect(res.status).toBe(200);
    expect((await res.json()).sessions).toHaveLength(1);
  });

  it("revoke: 404 unknown session", async () => {
    setup("organization_owner", null);
    expect((await POST(req("/api/v1/sessions/nope/revoke", "POST"), params("nope"))).status).toBe(404);
  });

  it("revoke: a member may revoke their OWN session", async () => {
    setup("report_viewer", sessionRow({ userId: "u1" }));
    const res = await POST(req("/api/v1/sessions/s1/revoke", "POST"), params("s1"));
    expect(res.status).toBe(200);
    expect((await res.json()).revokedAt).not.toBeNull();
  });

  it("revoke: 403 when not self and not owner/security_admin", async () => {
    setup("report_viewer", sessionRow({ userId: "u9" }));
    expect((await POST(req("/api/v1/sessions/s1/revoke", "POST"), params("s1"))).status).toBe(403);
  });

  it("revoke: owner can revoke any session", async () => {
    setup("organization_owner", sessionRow({ userId: "u9" }));
    const res = await POST(req("/api/v1/sessions/s1/revoke", "POST"), params("s1"));
    expect(res.status).toBe(200);
  });
});
