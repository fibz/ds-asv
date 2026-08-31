import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma-client";
import { GET, PATCH } from "./route";

vi.mock("jose", () => ({ jwtVerify: vi.fn(), createRemoteJWKSet: vi.fn(() => ({ mock: "jwks" })) }));

vi.mock("@/lib/prisma-client", () => {
  const txMock = {
    user: { create: vi.fn(), findUnique: vi.fn() },
    organizationMembership: { findFirst: vi.fn() },
    organization: { findUnique: vi.fn(), update: vi.fn() },
    contact: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    session: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    auditEvent: { create: vi.fn(), findMany: vi.fn() },
    $executeRawUnsafe: vi.fn(),
  };
  return { prisma: { ...txMock, $transaction: vi.fn((fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock)) } };
});

const CLAIMS = { sub: "kc-org-1", email: "owner@x.com" };

function req(method: string, body?: unknown) {
  return new NextRequest("http://localhost/api/v1/org", {
    method,
    headers: { Authorization: "Bearer a.b.c", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function setup(role: string, orgRow?: Record<string, unknown>) {
  vi.mocked(jwtVerify).mockResolvedValueOnce({ payload: CLAIMS, protectedHeader: {} } as never);
  vi.mocked(prisma.user.create).mockResolvedValueOnce({ id: "u1", idpId: CLAIMS.sub, email: CLAIMS.email, orgId: "org_1", role: "admin" } as never);
  vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: "u1", idpId: CLAIMS.sub, email: CLAIMS.email, orgId: "org_1", role: "admin" } as never);
  vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({ userId: "u1", organizationId: "org_1", role, status: "active" } as never);
  vi.mocked(prisma.organization.findUnique).mockResolvedValue(orgRow ?? { id: "org_1", name: "Acme", parentOrgId: null, createdAt: new Date(), updatedAt: new Date() } as never);
  vi.mocked(prisma.contact.findMany).mockResolvedValue([] as never);
}

describe("org profile routes", () => {
  beforeEach(() => { vi.stubEnv("APP_MODE", "prod"); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("GET returns the org profile for any member", async () => {
    setup("report_viewer");
    const res = await GET(req("GET"));
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("org_1");
  });

  it("PATCH is 403 for non-owners", async () => {
    setup("report_viewer");
    const res = await PATCH(req("PATCH", { name: "Hacked" }));
    expect(res.status).toBe(403);
  });

  it("PATCH is 400 for an empty name", async () => {
    setup("organization_owner");
    const res = await PATCH(req("PATCH", { name: "  " }));
    expect(res.status).toBe(400);
  });

  it("PATCH updates and returns the profile for an owner", async () => {
    setup("organization_owner", { id: "org_1", name: "New Name", parentOrgId: null, createdAt: new Date(), updatedAt: new Date() });
    vi.mocked(prisma.organization.update).mockResolvedValue({ id: "org_1", name: "New Name" } as never);
    const res = await PATCH(req("PATCH", { name: "New Name" }));
    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe("New Name");
    expect(prisma.auditEvent.create).toHaveBeenCalled();
  });
});
