import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Client } from "pg";
import { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma-client";
import { tenantContextFromRequest, setRlsContext } from "@/lib/tenant";
import { hashToken, revokeSession } from "@/lib/org/sessions";
import type { Prisma } from "@/lib/generated/prisma";

vi.mock("jose", () => ({
  jwtVerify: vi.fn(),
  createRemoteJWKSet: vi.fn(() => ({ mock: "jwks" })),
}));

const ORG = "org_auth_sess_0001";
const USER = "user_auth_sess_0001";
const IDP = "kc-auth-sess";

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

function bearerRequest(token: string) {
  return new NextRequest("http://localhost/api/v1/org", {
    headers: { Authorization: `Bearer ${token}`, "user-agent": "vitest" },
  });
}

async function adminWipe(): Promise<void> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await admin.connect();
  try {
    await admin.query(`DELETE FROM "Session" WHERE "organizationId" = $1`, [ORG]);
    await admin.query(`DELETE FROM "AuditEvent" WHERE "organizationId" = $1`, [ORG]);
    await admin.query(`DELETE FROM "OrganizationMembership" WHERE "organizationId" = $1`, [ORG]);
    await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [ORG]);
    await admin.query(`DELETE FROM "User" WHERE id = $1`, [USER]);
  } finally { await admin.end(); }
}

describe("session enforcement in auth", () => {
  beforeAll(async () => {
    await adminWipe();
    await withTenant(ORG, async (tx) => {
      await tx.organization.create({ data: { id: ORG, name: "Auth Sess Org" } });
      await tx.user.create({ data: { id: USER, idpId: IDP, email: "a@x.com" } });
      await tx.organizationMembership.create({ data: { userId: USER, organizationId: ORG, role: "organization_owner" } });
    });
    vi.mocked(jwtVerify).mockResolvedValue({ payload: { sub: IDP, email: "a@x.com" }, protectedHeader: {} } as never);
  });

  afterAll(async () => { await adminWipe(); await prisma.$disconnect(); });

  it("records a session row on first authenticated request", async () => {
    const ctx = await tenantContextFromRequest(bearerRequest("tok-1"));
    expect(ctx?.organizationId).toBe(ORG);
    const rows = await withTenant(ORG, (tx) => tx.session.findMany({ where: { tokenHash: hashToken("tok-1") } }));
    expect(rows).toHaveLength(1);
  });

  it("a revoked token is rejected on the next request", async () => {
    const ctx = await tenantContextFromRequest(bearerRequest("tok-2"));
    expect(ctx).not.toBeNull();
    const rows = await withTenant(ORG, (tx) => tx.session.findMany({ where: { tokenHash: hashToken("tok-2") } }));
    await revokeSession(ctx!, rows[0].id, "test revoke");
    expect(await tenantContextFromRequest(bearerRequest("tok-2"))).toBeNull();
    // a different (fresh) token still works
    expect(await tenantContextFromRequest(bearerRequest("tok-3"))).not.toBeNull();
  });
});
