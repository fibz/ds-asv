import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { createAsset, listAssets, getAsset, updateAsset, retireAsset, DuplicateAssetError } from "@/lib/assets/service";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

const ORG = "org_asset_svc_0001";
const ORG2 = "org_asset_svc_0002";
const USER = "user_asset_svc_0001";

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

const ctx: TenantContext = { userId: USER, organizationId: ORG, role: "asset_manager", isStaff: false, appMode: "dev" };

async function adminWipe(): Promise<void> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await admin.connect();
  try {
    for (const o of [ORG, ORG2]) {
      await admin.query(`DELETE FROM "AssetVerification" WHERE "organizationId" = $1`, [o]);
      await admin.query(`DELETE FROM "Asset" WHERE "organizationId" = $1`, [o]);
      await admin.query(`DELETE FROM "AssetImport" WHERE "organizationId" = $1`, [o]);
      await admin.query(`DELETE FROM "AuditEvent" WHERE "organizationId" = $1`, [o]);
      await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [o]);
    }
    await admin.query(`DELETE FROM "User" WHERE id = $1`, [USER]);
  } finally { await admin.end(); }
}

describe("asset service", () => {
  beforeAll(async () => {
    await adminWipe();
    await withTenant(ORG, async (tx) => {
      await tx.organization.create({ data: { id: ORG, name: "Asset Svc Org" } });
      await tx.user.create({ data: { id: USER, idpId: "kc-asset-svc", email: "svc@x.com" } });
    });
  });

  afterAll(async () => { await adminWipe(); await prisma.$disconnect(); });

  it("creates an asset with a canonical identifier", async () => {
    const a = await createAsset(ctx, { type: "ipv4", identifier: "010.0.0.1", displayName: "web" });
    expect(a.canonicalIdentifier).toBe("10.0.0.1");
    expect(a.lifecycleState).toBe("pending_verification");
    expect(a.verificationState).toBe("unverified");
  });

  it("dedupes: same (org, type, canonical) is a DuplicateAssetError", async () => {
    await createAsset(ctx, { type: "fqdn", identifier: "WWW.Example.COM" });
    await expect(createAsset(ctx, { type: "fqdn", identifier: "www.example.com." }))
      .rejects.toBeInstanceOf(DuplicateAssetError);
  });

  it("retired assets can be re-added (dedupe index excludes retired)", async () => {
    const a = await createAsset(ctx, { type: "ipv6", identifier: "2001:db8::1" });
    await retireAsset(ctx, a.id);
    const again = await createAsset(ctx, { type: "ipv6", identifier: "2001:0db8:0:0:0:0:0:1" });
    expect(again.canonicalIdentifier).toBe("2001:db8::1");
  });

  it("lists and filters by type + lifecycle", async () => {
    const all = await listAssets(ctx, {});
    expect(all.length).toBeGreaterThanOrEqual(3);
    const v4 = await listAssets(ctx, { type: "ipv4" });
    expect(v4.every((a) => a.type === "ipv4")).toBe(true);
    const retired = await listAssets(ctx, { lifecycleState: "retired" });
    expect(retired.length).toBeGreaterThanOrEqual(1);
  });

  it("get/update/retire are tenant-scoped and audited", async () => {
    const a = await createAsset(ctx, { type: "fqdn", identifier: "api.example.com", criticality: "high" });
    const updated = await updateAsset(ctx, a.id, { displayName: "API Gateway", owner: "sec@example.com" });
    expect(updated.displayName).toBe("API Gateway");

    const before = await getAsset(ctx, a.id);
    await retireAsset(ctx, a.id);
    const after = await getAsset(ctx, a.id);
    expect(after?.lifecycleState).toBe("retired");
    expect(before?.id).toBe(after?.id); // row preserved, not deleted

    const audits = await withTenant(ORG, (tx) => tx.auditEvent.findMany({ where: { resourceId: a.id }, orderBy: { createdAt: "asc" } }));
    expect(audits.map((e) => e.action)).toEqual(["asset.create", "asset.update", "asset.retire"]);
  });

  it("cross-tenant: cannot see or mutate another org's asset", async () => {
    await withTenant(ORG2, async (tx) => { await tx.organization.create({ data: { id: ORG2, name: "Other" } }); });
    const foreign = await prisma.$transaction(async (tx) => {
      await setRlsContext(ORG2, tx);
      return tx.asset.create({ data: { organizationId: ORG2, type: "ipv4", canonicalIdentifier: "9.9.9.9" } });
    });
    expect(await getAsset(ctx, foreign.id)).toBeNull();
    await expect(retireAsset(ctx, foreign.id)).rejects.toThrow();
    // cleanup
    const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
    await admin.connect();
    await admin.query(`DELETE FROM "Asset" WHERE "organizationId" = $1`, [ORG2]);
    await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [ORG2]);
    await admin.end();
  });
});
