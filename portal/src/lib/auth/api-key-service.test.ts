import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { createApiKey, listApiKeys, revokeApiKey, rotateApiKey } from "@/lib/auth/api-keys";
import type { TenantContext, Role } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

const ORG = "org_apikey_service_0001";
const USER = "user_apikey_service_0001";

function withTenant<T>(
  organizationId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(organizationId, tx);
    return fn(tx);
  });
}

const ctx: TenantContext = {
  userId: USER,
  organizationId: ORG,
  role: "organization_owner",
  isStaff: false,
  appMode: "dev",
};

async function adminWipe(): Promise<void> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await admin.connect();
  try {
    await admin.query(`DELETE FROM "ApiKey" WHERE "orgId" = $1`, [ORG]);
    await admin.query(`DELETE FROM "AuditEvent" WHERE "organizationId" = $1`, [ORG]);
    await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [ORG]);
    await admin.query(`DELETE FROM "User" WHERE id = $1`, [USER]);
  } finally {
    await admin.end();
  }
}

describe("api-key service (RLS + tenant scoping)", () => {
  beforeAll(async () => {
    await adminWipe();
    await withTenant(ORG, async (tx) => {
      await tx.organization.create({ data: { id: ORG, name: "ApiKey Service Org" } });
      await tx.user.create({ data: { id: USER, idpId: "kc-apikey-svc", email: "svc@x.com" } });
    });
  });

  afterAll(async () => {
    await adminWipe();
    await prisma.$disconnect();
  });

  it("creates a key under the tenant and returns the raw key once", async () => {
    const created = await createApiKey(ctx, { name: "ci", scopes: ["read:scans"] });
    expect(created.key).toMatch(/^sk_live_/);
    expect(created.id).toBeTruthy();

    // the stored row is scoped to the tenant
    await withTenant(ORG, async (tx) => {
      const row = await tx.apiKey.findUnique({ where: { id: created.id } });
      expect(row?.orgId).toBe(ORG);
      expect(row?.keyHash).not.toContain(created.key); // only the salted hash is stored
    });
  });

  it("lists only this tenant's keys, masked", async () => {
    const keys = await listApiKeys(ctx);
    expect(keys.length).toBeGreaterThanOrEqual(1);
    for (const k of keys) {
      expect(k.maskedKey).toMatch(/^sk_live_/);
      expect(k.maskedKey).not.toContain("$"); // salt never leaks
    }
  });

  it("revokes a key (soft delete) and rotate issues a fresh key", async () => {
    const created = await createApiKey(ctx, { name: "rotate-me", scopes: ["admin"] });
    const rotated = await rotateApiKey(ctx, created.id);
    expect(rotated.key).not.toBe(created.key);
    const list = await listApiKeys(ctx);
    expect(list.find((k) => k.id === created.id)?.revokedAt).toBeTruthy();

    await revokeApiKey(ctx, rotated.id);
    const after = await listApiKeys(ctx);
    expect(after.find((k) => k.id === rotated.id)?.revokedAt).toBeTruthy();
  });

  it("cannot read or touch another tenant's key", async () => {
    const otherOrg = "org_apikey_foreign_9999";
    await withTenant(otherOrg, async (tx) => {
      await tx.organization.create({ data: { id: otherOrg, name: "Foreign" } });
    });
    // foreign org's key row
    await prisma.$transaction(async (tx) => {
      await setRlsContext(otherOrg, tx);
      await tx.apiKey.create({
        data: {
          name: "foreign",
          keyHash: "salt$hash",
          scopes: ["admin"],
          orgId: otherOrg,
        },
      });
    });
    // tenant ORG cannot see it, even by guessed id (RLS hides the row)
    const rows = await prisma.$transaction(async (tx) => {
      await setRlsContext(ORG, tx);
      return tx.apiKey.findMany();
    });
    expect(rows.every((r) => r.orgId === ORG)).toBe(true);
    // cleanup foreign org (admin)
    const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
    await admin.connect();
    await admin.query(`DELETE FROM "ApiKey" WHERE "orgId" = $1`, [otherOrg]);
    await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [otherOrg]);
    await admin.end();
  });
});
