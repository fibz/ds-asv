import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { parseCsv, applyImport, getImportResult } from "@/lib/assets/import";
import { createAsset, retireAsset, listAssets, getAsset } from "@/lib/assets/service";
import { createVerificationChallenge, verifyAssetToken } from "@/lib/assets/verification";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

const ORG = "org_exit_0001";
const USER = "user_exit_0001";

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

const ctx: TenantContext = { userId: USER, organizationId: ORG, role: "asset_manager", isStaff: false, appMode: "dev" };

async function adminWipe(): Promise<void> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await admin.connect();
  try {
    await admin.query(`DELETE FROM "AssetVerification" WHERE "organizationId" = $1`, [ORG]);
    await admin.query(`DELETE FROM "Asset" WHERE "organizationId" = $1`, [ORG]);
    await admin.query(`DELETE FROM "AssetImport" WHERE "organizationId" = $1`, [ORG]);
    await admin.query(`DELETE FROM "AuditEvent" WHERE "organizationId" = $1`, [ORG]);
    await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [ORG]);
    await admin.query(`DELETE FROM "User" WHERE id = $1`, [USER]);
  } finally { await admin.end(); }
}

describe("Phase 2 exit criteria", () => {
  beforeAll(async () => {
    await adminWipe();
    await withTenant(ORG, async (tx) => {
      await tx.organization.create({ data: { id: ORG, name: "Exit Org" } });
      await tx.user.create({ data: { id: USER, idpId: "kc-exit", email: "exit@x.com" } });
    });
  });
  afterAll(async () => { await adminWipe(); await prisma.$disconnect(); });

  it("imports are idempotent: same key + same file never creates extra assets", async () => {
    const csv = `type,identifier,display_name\nipv4,10.1.0.1,a\nfqdn,one.example.com,b\n`;
    const rows = parseCsv(csv);
    const first = await applyImport(ctx, rows, "exit-imp-1");
    const second = await applyImport(ctx, rows, "exit-imp-1");
    expect(second.importId).toBe(first.importId);
    const count = await withTenant(ORG, (tx) => tx.asset.count());
    expect(count).toBe(2);
  });

  it("invalid rows are downloadable via the import result", async () => {
    const csv = `type,identifier\nipv4,10.2.0.1\nfqdn,-bad.example.com\n`;
    const rows = parseCsv(csv);
    const result = await applyImport(ctx, rows, "exit-imp-2");
    expect(result.summary.created).toBe(1);
    expect(result.summary.invalid).toBe(1);
    const stored = await getImportResult(ctx, result.importId);
    expect(stored?.invalidRows).toHaveLength(1);
    expect(JSON.stringify(stored?.invalidRows)).toMatch(/-bad\.example\.com/);
  });

  it("duplicates do not create extra assets (manual + import)", async () => {
    const csv = `type,identifier\nipv4,10.3.0.1\nipv4,10.3.0.1\n`;
    const rows = parseCsv(csv);
    const result = await applyImport(ctx, rows, "exit-imp-3");
    // second identical row is a within-file duplicate
    expect(result.summary.created).toBe(1);
    expect(result.summary.duplicates).toBe(1);
  });

  it("retiring referenced assets preserves history (row + audit + verification)", async () => {
    const a = await createAsset(ctx, { type: "fqdn", identifier: "retire.example.com" });
    const challenge = await createVerificationChallenge(ctx, a.id, "dns_txt");
    await verifyAssetToken(ctx, a.id, challenge.token);
    await retireAsset(ctx, a.id);

    const after = await getAsset(ctx, a.id);
    expect(after?.lifecycleState).toBe("retired");
    expect(after?.id).toBe(a.id); // row preserved

    const verifications = await withTenant(ORG, (tx) => tx.assetVerification.findMany({ where: { assetId: a.id } }));
    expect(verifications.length).toBeGreaterThanOrEqual(1);

    // Full audit trail: asset-scoped events (create/retire) plus the
    // verification-scoped events (challenge/verify) — Task 8 audits those
    // against the AssetVerification resource, not the asset row.
    const audits = await withTenant(ORG, (tx) => tx.auditEvent.findMany({
      where: { organizationId: ORG, OR: [{ resourceId: a.id }, { resourceId: { in: verifications.map((v) => v.id) } }] },
      orderBy: { createdAt: "asc" },
    }));
    expect(audits.map((e) => e.action)).toEqual(["asset.create", "asset.verification-challenge", "asset.verify", "asset.retire"]);
  });

  it("cross-tenant isolation holds for assets (RLS)", async () => {
    const other = "org_exit_foreign_9999";
    await withTenant(other, async (tx) => { await tx.organization.create({ data: { id: other, name: "F" } }); });
    const foreignAsset = await prisma.$transaction(async (tx) => {
      await setRlsContext(other, tx);
      return tx.asset.create({ data: { organizationId: other, type: "ipv4", canonicalIdentifier: "8.8.8.8" } });
    });
    expect(await getAsset(ctx, foreignAsset.id)).toBeNull();
    const all = await listAssets(ctx, {});
    expect(all.every((x) => x.organizationId === ORG)).toBe(true);
    const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
    await admin.connect();
    await admin.query(`DELETE FROM "Asset" WHERE "organizationId" = $1`, [other]);
    await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [other]);
    await admin.end();
  });
});
