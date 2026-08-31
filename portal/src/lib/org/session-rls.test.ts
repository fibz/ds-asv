import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

const ORG = "org_session_rls_0001";
const USER = "user_session_rls_0001";

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

async function adminWipe(): Promise<void> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await admin.connect();
  try {
    await admin.query(`DELETE FROM "Session" WHERE "organizationId" = $1`, [ORG]);
    await admin.query(`DELETE FROM "AuditEvent" WHERE "organizationId" = $1`, [ORG]);
    await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [ORG]);
    await admin.query(`DELETE FROM "User" WHERE id = $1`, [USER]);
  } finally { await admin.end(); }
}

describe("Session RLS", () => {
  beforeAll(async () => {
    await adminWipe();
    await withTenant(ORG, async (tx) => {
      await tx.organization.create({ data: { id: ORG, name: "Session RLS Org" } });
      await tx.user.create({ data: { id: USER, idpId: "kc-session-rls", email: "s@x.com" } });
    });
  });

  afterAll(async () => { await adminWipe(); await prisma.$disconnect(); });

  it("asv_app insert without tenant context is rejected (42501)", async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "Session" ("id","organizationId","userId","tokenHash") VALUES ($1,$2,$3,$4)`,
        "sx1", ORG, USER, "tok-hash-x"
      )
    ).rejects.toThrow(/42501/);
  });

  it("asv_app insert inside tenant context succeeds", async () => {
    await withTenant(ORG, (tx) =>
      tx.session.create({ data: { id: "sx2", organizationId: ORG, userId: USER, tokenHash: "tok-hash-ok" } })
    );
    const found = await withTenant(ORG, (tx) => tx.session.findUnique({ where: { tokenHash: "tok-hash-ok" } }));
    expect(found?.organizationId).toBe(ORG);
  });

  it("session table grants exclude DELETE for asv_app (revoke, never delete)", async () => {
    await withTenant(ORG, (tx) =>
      tx.session.create({ data: { id: "sx3", organizationId: ORG, userId: USER, tokenHash: "tok-hash-del" } })
    );
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM "Session" WHERE "id" = 'sx3'`)
    ).rejects.toThrow(/permission denied/);
  });
});
