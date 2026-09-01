import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

const ADMIN_URL = process.env.ADMIN_DATABASE_URL!;
const ORG = "org_scope_rls_0001";
const USER = "user_scope_rls_0001";

async function withTenant<T>(orgId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async (tx) => { await setRlsContext(orgId, tx); return fn(tx); });
}

async function adminWipe() {
  const pg = new Client({ connectionString: ADMIN_URL });
  await pg.connect();
  try {
    await pg.query(`DELETE FROM "Dispute" WHERE "organizationId" LIKE 'org_scope_rls_%'`);
    await pg.query(`DELETE FROM "Authorization" WHERE "organizationId" LIKE 'org_scope_rls_%'`);
    await pg.query(`DELETE FROM "ScopeItem" WHERE "organizationId" LIKE 'org_scope_rls_%'`);
    await pg.query(`DELETE FROM "ScopeVersion" WHERE "organizationId" LIKE 'org_scope_rls_%'`);
    await pg.query(`DELETE FROM "ScopeSet" WHERE "organizationId" LIKE 'org_scope_rls_%'`);
    await pg.query(`DELETE FROM "Organization" WHERE id = $1`, [ORG]);
    await pg.query(`DELETE FROM "User" WHERE id = $1`, [USER]);
  } finally {
    await pg.end();
  }
}

beforeAll(async () => {
  await adminWipe();
  const pg = new Client({ connectionString: ADMIN_URL });
  await pg.connect();
  try {
    await pg.query(`INSERT INTO "Organization" (id, name, "createdAt", "updatedAt") VALUES ($1, $2, now(), now())`, [ORG, "Scope RLS Org"]);
    await pg.query(`INSERT INTO "User" (id, "idpId", email, "createdAt", "updatedAt") VALUES ($1, $2, $3, now(), now())`, [USER, "kc-scope-rls-1", "a@x.com"]);
  } finally {
    await pg.end();
  }
});

afterAll(async () => {
  await adminWipe();
  await prisma.$disconnect();
});

describe("scope domain RLS", () => {
  it("rejects inserts without tenant context", async () => {
    await expect(
      prisma.scopeSet.create({ data: { organizationId: ORG, name: "x" } })
    ).rejects.toThrowError(/violates row-level security policy|42501/i);
  });

  it("inserts and reads all five tables under tenant context", async () => {
    const set = await withTenant(ORG, (tx) =>
      tx.scopeSet.create({ data: { organizationId: ORG, name: "PCI Scope" } })
    );
    const version = await withTenant(ORG, (tx) =>
      tx.scopeVersion.create({
        data: { scopeSetId: set.id, organizationId: ORG, versionNumber: 1, status: "draft" },
      })
    );
    await withTenant(ORG, (tx) =>
      tx.scopeItem.create({
        data: { scopeVersionId: version.id, organizationId: ORG, assetId: "a1", type: "ipv4", canonicalIdentifier: "10.1.1.1" },
      })
    );
    await withTenant(ORG, (tx) =>
      tx.authorization.create({
        data: {
          organizationId: ORG,
          scopeVersionId: version.id,
          statementHash: "h1",
          scopeVersionHash: "h2",
          signature: "sig",
        },
      })
    );
    const scan = await withTenant(ORG, (tx) =>
      tx.scan.create({ data: { id: "scan_scope_rls_1", organizationId: ORG, name: "RLS scope scan", requestedById: USER } })
    );
    const finding = await withTenant(ORG, (tx) =>
      tx.finding.create({ data: { id: "f_scope_rls_1", scanId: scan.id, assetId: "asset_scope_rls_1", organizationId: ORG, qid: "q1", severity: "4", title: "TLS weak" } })
    );
    await withTenant(ORG, (tx) =>
      tx.dispute.create({
        data: { findingId: finding.id, organizationId: ORG, raisedById: USER, justification: "not our host" },
      })
    );
    const sets = await withTenant(ORG, (tx) => tx.scopeSet.findMany({}));
    expect(sets.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects DELETE on ScopeSet (no grant)", async () => {
    const set = await withTenant(ORG, (tx) =>
      tx.scopeSet.create({ data: { organizationId: ORG, name: "Del" } })
    );
    await expect(withTenant(ORG, (tx) => tx.scopeSet.delete({ where: { id: set.id } }))).rejects.toThrow(
      /permission denied|42501/i
    );
  });
});